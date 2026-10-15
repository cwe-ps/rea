import { basename, extname } from "node:path";
import {
  createAnalysisExecution,
  type AnalysisExecution,
  type ExecutionOptions,
} from "../application/AnalysisProvider.js";
import type { BusinessRulesFilePort } from "../application/businessRules/BusinessRulesFileService.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import {
  businessRulesArtifactSchema,
  type BusinessRulesArtifact,
  type InspectBusinessRulesArtifactInput,
} from "../domain/businessRules/businessRulesArtifact.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  COMPILED_OBSERVATION_LIMITATIONS,
  compiledObservationTruncationLimitations,
  observeBusinessRulesCompiledProgram,
} from "./BusinessRulesCompiledObservation.js";
import { readBusinessRulesHeader } from "./BusinessRulesDecoder.js";
import {
  isBusinessRulesText,
  readBusinessRulesFile,
} from "./BusinessRulesFileRead.js";
import { decodeBusinessRulesProgram } from "./BusinessRulesProgramProvider.js";
import { BUSINESS_RULES_ARTIFACT_PROVIDER_IDENTITY } from "./BusinessRulesRelease.js";
import { indexBusinessRulesRuntimeConfig } from "./BusinessRulesRuntimeConfig.js";
import {
  indexBusinessRulesSource,
  looksLikeBusinessRulesSource,
} from "./BusinessRulesSourceText.js";
import {
  looksLikeBusinessRulesStatus,
  parseBusinessRulesStatus,
} from "./BusinessRulesStatusFile.js";

const OPERATION = "inspect_business_rules_artifact";
const SIGNATURE_PREFIX_BYTES = 4096;
const SOURCE_EXTENSIONS = new Set([".brs", ".wbs", ".prc", ".br", ".wb"]);
const CONFIG_NAME = "wbconfig.sys";
const SCREEN_NAME = /^screen\.\d+$/u;

const STATUS_LIMITATIONS = [
  "Status fields are read from the runtime's printed layout; lines no rule recognizes are kept verbatim in status.unparsed_lines rather than interpreted.",
  "Error codes, program states and drive paths are reported as printed; their runtime meaning is not evaluated, and paths are not resolved on this host.",
];

const SOURCE_LIMITATIONS = [
  "References are lexical: OPEN, CHAIN, EXECUTE, LIBRARY and DEF statements are recognized at the start of a line (after an optional label) or after THEN/ELSE, outside string literals and ! comments. Operands use the same projection as compiled listings; computed expressions are not evaluated.",
  "Statement continuations ending in !: are joined to their numbered line; references on a continuation report the physical line where that numbered line starts.",
  "The source is not compiled or executed; syntax errors are not detected and no symbol table is built.",
];

const CONFIG_LIMITATIONS = [
  "Directive keywords and values are reported verbatim; BR runtime semantics are not evaluated.",
];

const SCREEN_LIMITATIONS = [
  "The SCREEN fixed-record layout is not decoded; only identity, size and the name-based classification are reported.",
];

type Base = Pick<BusinessRulesArtifact, "artifact">;

const unsupported = (
  path: string,
  reason: string,
  remediationAction?: string,
): AnalysisError =>
  new AnalysisUnsupportedTargetError(
    OPERATION,
    path,
    reason,
    remediationAction === undefined ? undefined : { remediationAction },
  );

/**
 * Cross-check the observation against the full decoder: name any damage it
 * finds beyond the header, any facet it leaves undecoded, or confirm a clean
 * decode. Only called once the header layout checks pass.
 */
const decodeCrossCheck = (
  path: string,
  data: Uint8Array,
  sha256: string,
): string => {
  const decoded = decodeBusinessRulesProgram(path, data, sha256);
  if (!decoded.ok)
    return `Cross-check: full decoding with inspect_business_rules_program could not complete (${decoded.error.message}).`;
  const { program } = decoded.value;
  const damaged: string[] = [];
  if (program.listing.status === "malformed")
    damaged.push(`listing (${program.listing.reason ?? "malformed"})`);
  if (program.symbols.status === "malformed")
    damaged.push(`symbols (${program.symbols.reason ?? "malformed"})`);
  if (program.stripped_legacy?.line_table.status === "malformed")
    damaged.push(
      `stripped legacy line table (${program.stripped_legacy.line_table.reason ?? "malformed"})`,
    );
  if (damaged.length > 0)
    return `Cross-check: full decoding found damage beyond the header — ${damaged.join("; ")}.`;
  const undecoded: string[] = [];
  if (program.listing.status === "unsupported")
    undecoded.push(`listing (${program.listing.reason ?? "unsupported"})`);
  if (program.symbols.status === "unsupported")
    undecoded.push(`symbols (${program.symbols.reason ?? "unsupported"})`);
  if (undecoded.length > 0)
    return `Cross-check: inspect_business_rules_program decodes this file, leaving ${undecoded.join("; ")} undecoded.`;
  return "Cross-check: inspect_business_rules_program decodes this file cleanly.";
};

/** Classify the selected bytes and parse the matching facet. */
export const parseBusinessRulesArtifact = (
  path: string,
  data: Uint8Array,
  sha256: string,
): Result<BusinessRulesArtifact, AnalysisError> => {
  const base: Base = { artifact: { path, sha256, bytes: data.length } };
  const program = observeBusinessRulesCompiledProgram(data);
  if (program !== null) {
    const header = readBusinessRulesHeader(data);
    const checks = header.ok
      ? [decodeCrossCheck(path, data, sha256)]
      : [
          `Header layout checks failed (${header.error.message}); inspect_business_rules_program rejects this file, so only raw byte observations are reported.`,
        ];
    return ok({
      ...base,
      format: "compiled-program",
      classification:
        program.variant === "modern"
          ? {
              basis: "content-signature",
              detail:
                "Modern 51-byte big-endian compiled-program header signature (00 00 00 33 at offset 0).",
            }
          : {
              basis: "content-signature",
              detail:
                "Legacy 30/32-byte little-endian compiled-program header signature (0x0a at offset 8, header size as u32le at offset 20).",
            },
      program,
      decode_with: "inspect_business_rules_program",
      limitations: [
        ...COMPILED_OBSERVATION_LIMITATIONS,
        ...compiledObservationTruncationLimitations(program),
        ...checks,
      ],
    });
  }
  const name = basename(path).toLowerCase();
  const text = isBusinessRulesText(data)
    ? Buffer.from(data).toString("latin1")
    : null;
  if (name === CONFIG_NAME && (text !== null || data.length === 0))
    return ok({
      ...base,
      format: "runtime-config",
      classification: {
        basis: "extension-and-content",
        detail:
          "Whole-file-name match (WBCONFIG.SYS) over printable directive text.",
      },
      config: indexBusinessRulesRuntimeConfig(text ?? ""),
      limitations: CONFIG_LIMITATIONS,
    });
  if (SCREEN_NAME.test(name))
    return ok({
      ...base,
      format: "screen-file",
      classification: {
        basis: "extension-only",
        detail:
          "SCREEN.<number> session screen-definition name; the content carries no verified signature and the fixed-record layout is not decoded.",
      },
      limitations: SCREEN_LIMITATIONS,
    });
  if (text === null)
    return err(
      unsupported(
        path,
        "Binary content is neither a compiled program header nor Business Rules! text.",
      ),
    );
  const prefix = text.slice(0, SIGNATURE_PREFIX_BYTES);
  if (looksLikeBusinessRulesStatus(prefix)) {
    const status = parseBusinessRulesStatus(text);
    if (!status.ok)
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: `${status.error.message} (${path})`,
          },
        ]),
      );
    return ok({
      ...base,
      format: "status-file",
      classification: {
        basis: "content-signature",
        detail:
          "Leading WSID= line and a Program ID line, as printed by the Business Rules! runtime status (ST-FILE) dump.",
      },
      status: status.value,
      limitations: STATUS_LIMITATIONS,
    });
  }
  const extension = extname(path).toLowerCase();
  const byExtension = SOURCE_EXTENSIONS.has(extension);
  if (!byExtension && !looksLikeBusinessRulesSource(prefix))
    return err(
      unsupported(
        path,
        "Text is neither a status file nor recognizable Business Rules! source (no .brs/.wbs/.prc/.br/.wb name and no numbered statement lines with BR keywords).",
      ),
    );
  return ok({
    ...base,
    format: "source-text",
    classification: byExtension
      ? {
          basis: "extension-and-content",
          detail: `Text content under a Business Rules! source or program name (${extension}).`,
        }
      : {
          basis: "content-signature",
          detail:
            "Numbered statement lines containing Business Rules! keywords.",
        },
    source: indexBusinessRulesSource(text),
    limitations: SOURCE_LIMITATIONS,
  });
};

/** Read one selected Business Rules! artifact once and parse it in process. */
export class BusinessRulesArtifactProvider implements BusinessRulesFilePort {
  /** Classify by content signature first, then name, without executing anything. */
  async inspect(
    input: InspectBusinessRulesArtifactInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const read = await readBusinessRulesFile(
      BUSINESS_RULES_ARTIFACT_PROVIDER_IDENTITY.id,
      OPERATION,
      input.path,
      options,
    );
    if (!read.ok) return read;
    const parsed = parseBusinessRulesArtifact(
      input.path,
      read.value.bytes,
      read.value.sha256,
    );
    if (!parsed.ok) return parsed;
    const validated = businessRulesArtifactSchema.safeParse(parsed.value);
    if (!validated.success)
      return err(
        new AnalysisOutputError(
          OPERATION,
          `Parsed artifact failed its result contract: ${validated.error.issues[0]?.message ?? "schema mismatch"}`,
        ),
      );
    return ok(
      createAnalysisExecution(
        validated.data,
        BUSINESS_RULES_ARTIFACT_PROVIDER_IDENTITY,
        {
          rawResult: null,
          subject: {
            path: input.path,
            format: "file",
            sha256: read.value.sha256,
          },
          locations: [{ kind: "artifact-path", path: input.path }],
          limitations: validated.data.limitations,
        },
      ),
    );
  }
}
