import {
  createAnalysisExecution,
  type AnalysisExecution,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import type { BusinessRulesProgramPort } from "../application/businessRules/BusinessRulesProgramPort.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { readStableArtifact } from "../artifacts/readStableArtifact.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
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
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  readBusinessRulesHeader,
  readBusinessRulesSourceRecords,
  readBusinessRulesSymbols,
  renderBusinessRulesTokens,
  tokenizeBusinessRulesRecord,
  type BusinessRulesFormatFailure,
  type BusinessRulesHeader,
  type BusinessRulesSymbolRecord,
} from "./BusinessRulesDecoder.js";
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
import {
  BUSINESS_RULES_PROGRAM_LIMITS,
  BUSINESS_RULES_PROVIDER_IDENTITY,
} from "./BusinessRulesRelease.js";

const OPERATION = "inspect_business_rules_program";

const BASE_LIMITATIONS = [
  "References are derived from decoded listing statements (OPEN, CHAIN, LIBRARY, DEF). Computed operands are reported unevaluated; OPEN entries include screen/window opens as well as files.",
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
      "The saved LIST section has zero length (stripped program). Execution-stream decoding supports only the modern layout, so program text is unknown; header and section layout are still reported.",
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
  if (!header.ok)
    return err(
      header.error.kind === "unsupported"
        ? new AnalysisUnsupportedTargetError(
            OPERATION,
            path,
            header.error.message,
          )
        : new AnalysisInputError(OPERATION, undefined, [
            {
              path: ["path"],
              reason: "invalid_format",
              message: `${header.error.message} (${path})`,
            },
          ]),
    );
  const symbols = readBusinessRulesSymbols(data, header.value);
  const stripped = header.value.listingSize === 0;
  // A saved LIST is preferred when present; the execution stream is decoded only for stripped programs.
  const { listing, records } = stripped
    ? decodeExecutionListing(data, header.value, symbols)
    : decodeSavedListing(data, header.value);
  const symbolStatus = symbols.ok ? "decoded" : symbols.error.kind;
  const limitations = [
    ...(listing.basis === "execution-stream"
      ? EXECUTION_STREAM_LIMITATIONS
      : SAVED_LIST_LIMITATIONS),
    ...BASE_LIMITATIONS,
  ];
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

const readFailure = (cause: unknown, path: string): AnalysisError => {
  if (cause instanceof AnalysisError) return cause;
  if (cause instanceof ArtifactReaderFailure) {
    if (cause.reason === "cancelled")
      return new AnalysisCancelledError(OPERATION);
    if (cause.reason === "integrity")
      return new AnalysisArtifactChangedError(OPERATION, path, cause.message, {
        cause,
      });
    if (["limit", "path", "format"].includes(cause.reason))
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: cause.reason === "limit" ? "out_of_range" : "invalid_format",
          message: cause.message,
        },
      ]);
  }
  if (cause instanceof Error && "code" in cause) {
    if (cause.code === "EACCES" || cause.code === "EPERM")
      return new AnalysisAccessDeniedError(OPERATION, path, cause.code, {
        cause,
      });
    if (cause.code === "ENOENT" || cause.code === "ENOTDIR")
      return new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Selected program could not be read (${String(cause.code)}): ${path}.`,
        },
      ]);
  }
  return new ProviderAdapterError(
    BUSINESS_RULES_PROVIDER_IDENTITY.id,
    OPERATION,
    {
      cause,
      diagnostics: {
        phase: "artifact-read",
        reason: cause instanceof Error ? cause.message : String(cause),
      },
    },
  );
};

/** Decode header, modern symbols and the saved LIST (or, when stripped, the execution stream) from one stable program snapshot. */
export class BusinessRulesProgramProvider implements BusinessRulesProgramPort {
  /** Read the selected file once, then decode in-process without executing it. */
  async inspect(
    input: InspectBusinessRulesProgramInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    let artifact: { readonly bytes: Buffer; readonly sha256: string };
    try {
      artifact = await readStableArtifact(
        input.path,
        BUSINESS_RULES_PROGRAM_LIMITS.inputBytes,
        options?.signal,
      );
    } catch (cause: unknown) {
      return err(
        options?.signal?.aborted
          ? new AnalysisCancelledError(OPERATION)
          : readFailure(cause, input.path),
      );
    }
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
