import { extname } from "node:path";
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
import { readBusinessRulesHeader } from "./BusinessRulesDecoder.js";
import {
  isBusinessRulesText,
  readBusinessRulesFile,
} from "./BusinessRulesFileRead.js";
import { BUSINESS_RULES_ARTIFACT_PROVIDER_IDENTITY } from "./BusinessRulesRelease.js";
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

const STATUS_LIMITATIONS = [
  "Status fields are read from the runtime's printed layout; lines no rule recognizes are kept verbatim in status.unparsed_lines rather than interpreted.",
  "Error codes, program states and drive paths are reported as printed; their runtime meaning is not evaluated, and paths are not resolved on this host.",
];

const SOURCE_LIMITATIONS = [
  "References are lexical: OPEN, CHAIN, EXECUTE, LIBRARY and DEF statements are recognized at the start of a line (after an optional label) or after THEN/ELSE, outside string literals and ! comments. Operands use the same projection as compiled listings; computed expressions are not evaluated.",
  "Statement continuations ending in !: are joined to their numbered line; references on a continuation report the physical line where that numbered line starts.",
  "The source is not compiled or executed; syntax errors are not detected and no symbol table is built.",
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

/** Classify the selected bytes and parse the matching facet. */
export const parseBusinessRulesArtifact = (
  path: string,
  data: Uint8Array,
  sha256: string,
): Result<BusinessRulesArtifact, AnalysisError> => {
  const header = readBusinessRulesHeader(data);
  if (header.ok || header.error.kind === "malformed")
    return err(
      unsupported(
        path,
        "The file carries a compiled Business Rules! program header.",
        "Decode compiled programs with inspect_business_rules_program.",
      ),
    );
  if (!isBusinessRulesText(data))
    return err(
      unsupported(
        path,
        "Binary content is neither a compiled program header nor Business Rules! text.",
      ),
    );
  const text = Buffer.from(data).toString("latin1");
  const prefix = text.slice(0, SIGNATURE_PREFIX_BYTES);
  const base: Base = { artifact: { path, sha256, bytes: data.length } };
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

/** Read one selected status file or source text once and parse it in process. */
export class BusinessRulesArtifactProvider implements BusinessRulesFilePort {
  /** Classify by content first, then name, without executing anything. */
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
