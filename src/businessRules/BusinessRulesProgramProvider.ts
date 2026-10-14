import {
  createAnalysisExecution,
  type AnalysisExecution,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import type { BusinessRulesFilePort } from "../application/businessRules/BusinessRulesFileService.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import {
  businessRulesProgramSchema,
  type BusinessRulesProgram,
  type BusinessRulesSymbol,
  type InspectBusinessRulesProgramInput,
} from "../domain/businessRules/businessRulesProgram.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  readBusinessRulesHeader,
  readBusinessRulesLineTable,
  readBusinessRulesSourceRecord,
  readBusinessRulesSourceRecords,
  readBusinessRulesSymbols,
  renderBusinessRulesTokens,
  tokenizeBusinessRulesRecord,
  type BusinessRulesFormatFailure,
  type BusinessRulesHeader,
  type BusinessRulesLineSlot,
  type BusinessRulesSymbolRecord,
} from "./BusinessRulesDecoder.js";
import {
  isBusinessRulesText,
  readBusinessRulesFile,
} from "./BusinessRulesFileRead.js";
import { decodeBusinessRulesExecution } from "./BusinessRulesExecutionListing.js";
import {
  deriveBusinessRulesReferences,
  executionReferenceRecords,
  type BusinessRulesTokenizedRecord,
} from "./BusinessRulesReferences.js";
import {
  BUSINESS_RULES_CLAUSES,
  BUSINESS_RULES_STATEMENTS,
} from "./BusinessRulesTokens.js";
import { BUSINESS_RULES_PROVIDER_IDENTITY } from "./BusinessRulesRelease.js";

const OPERATION = "inspect_business_rules_program";

const BASE_LIMITATIONS = [
  "References are derived from decoded listing statements (OPEN, CHAIN, EXECUTE, LIBRARY, DEF). Computed operands are reported unevaluated; OPEN entries include screen/window opens as well as files.",
  "Header version/option bytes and most line-table and symbol attribute bits are reported raw; their meanings are unknown.",
  "Decoding is static and in-process: no Business Rules! runtime, program execution or paired source is used.",
];

const SAVED_LIST_LIMITATIONS = [
  "Listing text is reconstructed from the program's saved LIST tokens. Compiled LIST stores canonical uppercase keywords and identifiers, PRINT for PR and explicit LET; original source spelling, Lexi preprocessing and comments removed before compilation are not recoverable.",
  "Some keyword spellings are inferred from compiled-only examples. Unresolved token codes remain visible as [[gg:cc]] placeholders and are listed in listing.unresolved_keywords.",
];

const EXECUTION_STREAM_LIMITATIONS = [
  "The saved LIST was removed (stripped program); listing text is decompiled from the execution stream with the line and symbol tables. Comments, REM text and labels are not stored there: labels and line-number jump targets are both shown as line numbers, and comment-only lines appear as `!`.",
  "Source spelling the execution stream does not keep is not recoverable: keyword abbreviations (PR/PRINT), implicit versus explicit LET, identifier case, quote style, redundant parentheses (minimal parentheses are emitted by precedence), numeric literal spelling (`.5`), `==`/`=>` aliases, `udim(mat X)` versus `udim(X)` and explicit default `*18` lengths. Indentation is synthesized at two spaces per block level.",
  "Execution-stream output uses lowercase keywords and builtin functions and Title_Case identifiers per underscore-separated part; string literals are double-quoted with doubled embedded quotes. DIM and DATA lines are rendered from the source records the compiler embeds in the execution section.",
  "Undecoded instructions stay visible as `<?...>` markers (or `! <undecodable: kind> hex` lines) and are listed per line in listing.unknown_markers.",
];

const STRIPPED_LEGACY_LIMITATIONS = [
  "Legacy stripped program: stripped_legacy reports the line-table chain (line numbers in program order, compiled-code offsets and raw slot flag bytes) and the DIM/DATA source records the compiler embeds in the execution section. Statements other than embedded DIM/DATA have text null; their execution code is not decoded.",
  "stripped_legacy.symbol_section_strings are raw printable runs of at least four bytes inside the legacy symbol section. They include symbol names and string literals but also adjacent attribute bytes that happen to be printable; slot boundaries, names shorter than four bytes and literal values are not separated.",
];

const MIN_PRINTABLE_RUN = 4;

/** Printable ASCII runs inside one section; raw observations, not decoded entries. */
const printableRuns = (
  data: Uint8Array,
  start: number,
  end: number,
): { offset: number; text: string }[] => {
  const runs: { offset: number; text: string }[] = [];
  let run = -1;
  for (let offset = start; offset <= end; offset += 1) {
    const byte = offset < end ? data[offset] : undefined;
    const printable = byte !== undefined && byte >= 0x20 && byte <= 0x7e;
    if (printable && run < 0) run = offset;
    else if (!printable && run >= 0) {
      if (offset - run >= MIN_PRINTABLE_RUN)
        runs.push({
          offset: run,
          text: Buffer.from(data.subarray(run, offset)).toString("latin1"),
        });
      run = -1;
    }
  }
  return runs;
};

/** Render one embedded DIM/DATA source record a line-table slot points to. */
const embeddedSourceText = (
  data: Uint8Array,
  header: BusinessRulesHeader,
  line: BusinessRulesLineSlot,
): Result<{ offset: number; text: string }, BusinessRulesFormatFailure> => {
  const record = readBusinessRulesSourceRecord(data, header, line);
  if (!record.ok) return record;
  const tokens = tokenizeBusinessRulesRecord(
    record.value.body,
    header.oldClauses,
  );
  if (!tokens.ok) return tokens;
  return ok({
    offset: record.value.offset,
    text: renderBusinessRulesTokens(tokens.value),
  });
};

/** Line-table and symbol-section observations for a stripped legacy program. */
const strippedLegacyFacts = (
  data: Uint8Array,
  header: BusinessRulesHeader,
): NonNullable<BusinessRulesProgram["stripped_legacy"]> => {
  const symbol_section_strings = printableRuns(
    data,
    header.symbolsStart,
    header.symbolsStart + header.symbolsSize,
  );
  const malformed = (
    reason: string,
  ): NonNullable<BusinessRulesProgram["stripped_legacy"]> => ({
    evidence_kind: "observed",
    line_table: { status: "malformed", reason, lines: [] },
    symbol_section_strings,
  });
  const table = readBusinessRulesLineTable(data, header);
  if (!table.ok) return malformed(table.error.message);
  const lines: NonNullable<
    BusinessRulesProgram["stripped_legacy"]
  >["line_table"]["lines"] = [];
  for (const line of table.value) {
    if (line.number > 99_999 || line.code >= header.codeSize)
      return malformed(
        `Line-table slot ${String(line.slot)} carries line ${String(line.number)} with code offset 0x${line.code.toString(16)} outside the execution section.`,
      );
    let recordOffset: number | null = null;
    let text: string | null = null;
    if (line.embedded) {
      const embedded = embeddedSourceText(data, header, line);
      if (!embedded.ok)
        return malformed(
          `Line ${String(line.number)}: ${embedded.error.message}`,
        );
      recordOffset = embedded.value.offset;
      text = embedded.value.text;
    }
    lines.push({
      number: line.number,
      slot: line.slot,
      flags: line.flags,
      code_offset: header.codeStart + line.code,
      embedded: line.embedded,
      record_offset: recordOffset,
      text,
    });
  }
  return {
    evidence_kind: "observed",
    line_table: { status: "decoded", reason: null, lines },
    symbol_section_strings,
  };
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

const projectSymbol = (
  symbol: BusinessRulesSymbolRecord,
): BusinessRulesSymbol => {
  const constant = (symbol.flags & 0x2000) !== 0;
  const string = (symbol.flags & 0x4000) !== 0;
  const kind: BusinessRulesSymbol["kind"] = constant
    ? string
      ? "string-constant"
      : "numeric-constant"
    : (symbol.flags & 0x8000) !== 0
      ? "function"
      : symbol.dimensions === null
        ? "scalar"
        : "array";
  const numeric =
    symbol.numericBits === null
      ? null
      : new DataView(
          symbol.numericBits.buffer,
          symbol.numericBits.byteOffset,
          8,
        ).getFloat64(0);
  return {
    index: symbol.index,
    offset: symbol.offset,
    name: symbol.name === "" ? null : symbol.name,
    kind,
    value_type: string ? "string" : "numeric",
    flags: symbol.flags,
    declared_width: symbol.declaredWidth,
    definition_slot: symbol.definitionSlot,
    name_tag: symbol.nameTag,
    dimensions: symbol.dimensions === null ? null : [...symbol.dimensions],
    string_length: symbol.stringValue?.length ?? null,
    numeric_value:
      numeric !== null && Number.isFinite(numeric) ? numeric : null,
    numeric_bits: symbol.numericBits === null ? null : hex(symbol.numericBits),
  };
};

const projectHeader = (
  header: BusinessRulesHeader,
): BusinessRulesProgram["header"] => ({
  variant: header.modern ? "modern" : "legacy",
  header_bytes: header.headerBytes,
  byteorder: header.littleEndian ? "little" : "big",
  version_bytes: hex(header.versionBytes),
  option_bytes: hex(header.optionBytes),
  first_line_slot: header.firstLine,
  line_slots: header.lineSlots,
  symbol_slots: header.symbolSlots,
  legacy_clause_codes: header.oldClauses,
  sections: {
    execution: { offset: header.codeStart, bytes: header.codeSize },
    line_table: { offset: header.tableStart, bytes: header.tableSize },
    symbols: { offset: header.symbolsStart, bytes: header.symbolsSize },
    listing: { offset: header.listingStart, bytes: header.listingSize },
  },
});

type ListingProjection = {
  readonly listing: BusinessRulesProgram["listing"];
  readonly records: readonly BusinessRulesTokenizedRecord[];
};

const unavailableListing = (
  status: "absent" | "unsupported" | "malformed",
  reason: string,
): ListingProjection => ({
  listing: {
    status,
    basis: null,
    reason,
    lines: [],
    unresolved_keywords: [],
    unknown_markers: [],
  },
  records: [],
});

const decodeSavedListing = (
  data: Uint8Array,
  header: BusinessRulesHeader,
): ListingProjection => {
  const sourceRecords = readBusinessRulesSourceRecords(data, header);
  if (!sourceRecords.ok)
    return unavailableListing(
      sourceRecords.error.kind,
      sourceRecords.error.message,
    );
  const lines: BusinessRulesProgram["listing"]["lines"] = [];
  const records: BusinessRulesTokenizedRecord[] = [];
  const unresolved = new Map<string, { group: 1 | 2; code: number }>();
  for (const record of sourceRecords.value) {
    const tokens = tokenizeBusinessRulesRecord(record.body, header.oldClauses);
    if (!tokens.ok)
      return unavailableListing(
        tokens.error.kind,
        `Line ${String(record.number)} at 0x${record.offset.toString(16)}: ${tokens.error.message}`,
      );
    for (const token of tokens.value)
      if (
        (token.group === 1 || token.group === 2) &&
        !(
          token.group === 1 ? BUSINESS_RULES_STATEMENTS : BUSINESS_RULES_CLAUSES
        ).has(token.code)
      )
        unresolved.set(`${String(token.group)}:${String(token.code)}`, {
          group: token.group,
          code: token.code,
        });
    records.push({ number: record.number, tokens: tokens.value });
    lines.push({
      number: record.number,
      text: renderBusinessRulesTokens(tokens.value),
      record_offset: record.offset,
      embedded: record.embedded,
    });
  }
  return {
    listing: {
      status: "decoded",
      basis: "saved-list",
      reason: null,
      lines,
      unresolved_keywords: [...unresolved.values()]
        .sort(
          (left, right) => left.group - right.group || left.code - right.code,
        )
        .map(({ group, code }) => ({
          group: group === 1 ? "statement" : "clause",
          code,
        })),
      unknown_markers: [],
    },
    records,
  };
};

const decodeExecutionListing = (
  data: Uint8Array,
  header: BusinessRulesHeader,
  symbols: Result<
    readonly BusinessRulesSymbolRecord[],
    BusinessRulesFormatFailure
  >,
): ListingProjection => {
  if (!header.modern)
    return unavailableListing(
      "absent",
      "The saved LIST section has zero length (stripped program). Execution-stream decoding supports only the modern layout, so program text is unknown; header, section layout and the observed line table (stripped_legacy) are still reported.",
    );
  if (!symbols.ok)
    return unavailableListing(
      symbols.error.kind,
      `The saved LIST section has zero length (stripped program) and execution-stream operands cannot be resolved without the symbol table: ${symbols.error.message}`,
    );
  const decoded = decodeBusinessRulesExecution(data, header, symbols.value);
  if (!decoded.ok)
    return unavailableListing(
      decoded.error.kind,
      `Execution stream not decoded: ${decoded.error.message}`,
    );
  return {
    listing: {
      status: "decoded",
      basis: "execution-stream",
      reason: null,
      lines: decoded.value.map((line) => ({
        number: line.number,
        text: line.text,
        record_offset: line.offset,
        embedded: line.embedded,
      })),
      unresolved_keywords: [],
      unknown_markers: decoded.value.flatMap((line) =>
        line.unknowns.map((marker) => ({ line: line.number, marker })),
      ),
    },
    records: executionReferenceRecords(decoded.value),
  };
};

const strippedLegacyLimitations = (
  facts: NonNullable<BusinessRulesProgram["stripped_legacy"]>,
): string[] =>
  facts.line_table.status === "malformed"
    ? [
        ...STRIPPED_LEGACY_LIMITATIONS,
        `Legacy line table not decoded: ${facts.line_table.reason ?? "malformed"}`,
      ]
    : [...STRIPPED_LEGACY_LIMITATIONS];

/** Unrecognized containers are unsupported targets; damaged recognized headers are invalid input. */
const headerFailure = (
  path: string,
  data: Uint8Array,
  failure: BusinessRulesFormatFailure,
): AnalysisError =>
  failure.kind === "unsupported"
    ? new AnalysisUnsupportedTargetError(
        OPERATION,
        path,
        failure.message,
        isBusinessRulesText(data)
          ? {
              remediationAction:
                "The file is text, not a compiled program. Inspect Business Rules! source or a runtime status file with inspect_business_rules_artifact.",
            }
          : undefined,
      )
    : new AnalysisInputError(OPERATION, undefined, [
        {
          path: ["path"],
          reason: "invalid_format",
          message: `${failure.message} (${path})`,
        },
      ]);

/** Decode one compiled program from stable bytes; pure apart from the file read. */
export const decodeBusinessRulesProgram = (
  path: string,
  data: Uint8Array,
  sha256: string,
): Result<
  { readonly program: BusinessRulesProgram; readonly limitations: string[] },
  AnalysisError
> => {
  const header = readBusinessRulesHeader(data);
  if (!header.ok) return err(headerFailure(path, data, header.error));
  const symbols = readBusinessRulesSymbols(data, header.value);
  const stripped = header.value.listingSize === 0;
  // A saved LIST is preferred when present; the execution stream is decoded only for stripped programs.
  const { listing, records } = stripped
    ? decodeExecutionListing(data, header.value, symbols)
    : decodeSavedListing(data, header.value);
  const symbolStatus = symbols.ok ? "decoded" : symbols.error.kind;
  const strippedLegacy =
    stripped && !header.value.modern
      ? strippedLegacyFacts(data, header.value)
      : null;
  const limitations = [
    ...(listing.basis === "execution-stream"
      ? EXECUTION_STREAM_LIMITATIONS
      : SAVED_LIST_LIMITATIONS),
    ...BASE_LIMITATIONS,
  ];
  if (strippedLegacy !== null)
    limitations.push(...strippedLegacyLimitations(strippedLegacy));
  if (!symbols.ok)
    limitations.push(`Symbol table not decoded: ${symbols.error.message}`);
  if (listing.status !== "decoded")
    limitations.push(
      stripped
        ? "Program text and listing-derived references are unknown because the saved LIST was removed and the execution stream could not be decoded."
        : "Program text and listing-derived references are unknown because the saved LIST could not be decoded.",
    );
  const program = {
    artifact: { path, sha256, bytes: data.length },
    header: projectHeader(header.value),
    listing,
    symbols: {
      status: symbolStatus,
      reason: symbols.ok ? null : symbols.error.message,
      entries: symbols.ok ? symbols.value.map(projectSymbol) : [],
    },
    string_constants: {
      status: symbolStatus,
      values: symbols.ok
        ? symbols.value.flatMap((symbol) =>
            symbol.stringValue === null
              ? []
              : [{ symbol_index: symbol.index, value: symbol.stringValue }],
          )
        : [],
    },
    stripped_legacy: strippedLegacy,
    references: {
      evidence_kind: "derived" as const,
      status: listing.status === "decoded" ? "derived" : "unknown",
      ...deriveBusinessRulesReferences(records),
    },
    limitations,
  };
  const validated = businessRulesProgramSchema.safeParse(program);
  if (!validated.success)
    return err(
      new AnalysisOutputError(
        OPERATION,
        `Decoded program failed its result contract: ${validated.error.issues[0]?.message ?? "schema mismatch"}`,
      ),
    );
  return ok({ program: validated.data, limitations });
};

/** Decode header, modern symbols and the saved LIST (or, when stripped, the execution stream) from one stable program snapshot. */
export class BusinessRulesProgramProvider implements BusinessRulesFilePort {
  /** Read the selected file once, then decode in-process without executing it. */
  async inspect(
    input: InspectBusinessRulesProgramInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const read = await readBusinessRulesFile(
      BUSINESS_RULES_PROVIDER_IDENTITY.id,
      OPERATION,
      input.path,
      options,
    );
    if (!read.ok) return read;
    const artifact = read.value;
    const decoded = decodeBusinessRulesProgram(
      input.path,
      artifact.bytes,
      artifact.sha256,
    );
    if (!decoded.ok) return decoded;
    return ok(
      createAnalysisExecution(
        decoded.value.program,
        BUSINESS_RULES_PROVIDER_IDENTITY,
        {
          // The validated decoder projection is the only producer representation.
          rawResult: null,
          subject: {
            path: input.path,
            format: "file",
            sha256: artifact.sha256,
          },
          locations: [{ kind: "artifact-path", path: input.path }],
          limitations: decoded.value.limitations,
        },
      ),
    );
  }
}
