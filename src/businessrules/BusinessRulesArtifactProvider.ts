import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import type { ExecutionOptions } from "../application/AnalysisProvider.js";
import type { BusinessRulesArtifactPort } from "../application/businessRules/BusinessRulesArtifactPort.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import type { BusinessRulesArtifact } from "../domain/businessrules/businessRulesArtifact.js";
import {
  businessRulesClassificationBasis,
  classifyBusinessRulesPath,
  confirmBusinessRulesFormat,
  sniffBusinessRulesContent,
  type BusinessRulesFormat,
} from "../domain/businessrules/businessRulesFormat.js";
import { err, ok, type Result } from "../domain/result.js";
import { indexBrSource } from "./SourceIndex.js";
import { indexBrConfig } from "./RuntimeConfig.js";
import { parseStatusFile } from "./StatusFile.js";
import { parseWbProgram, wbProgramLimitations } from "./WbProgram.js";

const OPERATION = "inspect_business_rules_artifact";
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const CLASSIFICATION_PREFIX_BYTES = 4096;

/** Identity of the built-in BR parser; no external tools are involved. */
export const BUSINESS_RULES_PROVIDER_IDENTITY = {
  id: "rea-business-rules",
  name: "REA Business Rules! artifact parser",
  version: null,
} as const;

const sha256Of = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const describeClassification = (format: BusinessRulesFormat): string => {
  switch (format) {
    case "br-compiled":
      return "Compiled BR program (.WB); header variant signature verified from content bytes.";
    case "br-source":
      return "Line-numbered BR source (.brs/.wbs); confirmed as text content.";
    case "br-status":
      return "BR status/crash file (ST-FILE.*); WSID and Program ID markers verified from content.";
    case "br-procedure":
      return "BR procedure script (.prc); confirmed as text content.";
    case "br-screen":
      return "BR screen definition (SCREEN.*); extension-only classification, record layout not decoded.";
    case "br-config":
      return "BR runtime configuration (WBCONFIG.SYS); confirmed as text content.";
  }
};

const readArtifact = async (
  path: string,
  signal: AbortSignal | undefined,
): Promise<Result<Buffer, AnalysisError>> => {
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile())
      return err(
        new AnalysisUnsupportedTargetError(
          OPERATION,
          path,
          "Expected a regular file.",
        ),
      );
    size = info.size;
  } catch (cause: unknown) {
    return err(readFailure(path, cause));
  }
  if (size > MAX_ARTIFACT_BYTES)
    return err(
      new AnalysisResourceConstraintError(
        OPERATION,
        "file-size",
        `Selected artifact is ${size} bytes; the BR parser accepts at most ${MAX_ARTIFACT_BYTES} bytes.`,
        { selected_bytes: size, max_bytes: MAX_ARTIFACT_BYTES },
      ),
    );
  if (signal?.aborted) return err(new AnalysisCancelledError(OPERATION));
  try {
    return ok(await readFile(path));
  } catch (cause: unknown) {
    return err(readFailure(path, cause));
  }
};

const readFailure = (path: string, cause: unknown): AnalysisError => {
  const code = (cause as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM")
    return new AnalysisAccessDeniedError(OPERATION, path, code);
  return new AnalysisInputError(OPERATION, { cause }, [
    {
      path: ["path"],
      reason: "invalid_value",
      message: `Could not read the selected file (${code ?? "unknown error"}).`,
    },
  ]);
};

/** Pure local parser for Business Rules! artifacts; reads only the selected file. */
export class BusinessRulesArtifactProvider implements BusinessRulesArtifactPort {
  readonly identity = BUSINESS_RULES_PROVIDER_IDENTITY;

  async inspect(
    input: { readonly path: string },
    options?: ExecutionOptions,
  ): Promise<Result<BusinessRulesArtifact, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const read = await readArtifact(input.path, options?.signal);
    if (!read.ok) return read;
    const bytes = read.value;
    const prefix = bytes.subarray(0, CLASSIFICATION_PREFIX_BYTES);
    const pathFormat = classifyBusinessRulesPath(input.path);
    const format =
      pathFormat === undefined
        ? sniffBusinessRulesContent(prefix)
        : confirmBusinessRulesFormat(pathFormat, prefix);
    if (format === undefined || format === "file")
      return err(
        new AnalysisUnsupportedTargetError(
          OPERATION,
          input.path,
          "Bytes and name do not match a recognized Business Rules! artifact format.",
        ),
      );
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const base = {
      artifact: {
        path: input.path,
        sha256: sha256Of(bytes),
        bytes: bytes.length,
      },
      classification: {
        basis: businessRulesClassificationBasis(format),
        detail: describeClassification(format),
      },
    };
    return this.parse(format, base, bytes);
  }

  private parse(
    format: BusinessRulesFormat,
    base: Pick<BusinessRulesArtifact, "artifact" | "classification">,
    bytes: Buffer,
  ): Result<BusinessRulesArtifact, AnalysisError> {
    switch (format) {
      case "br-compiled": {
        const program = parseWbProgram(bytes);
        if (program === null)
          return err(
            new AnalysisUnsupportedTargetError(
              OPERATION,
              base.artifact.path,
              "Compiled-program header variant could not be confirmed.",
            ),
          );
        return ok({
          ...base,
          format,
          program,
          limitations: wbProgramLimitations(),
        });
      }
      case "br-status": {
        const status = parseStatusFile(bytes.toString("latin1"));
        if (status === null)
          return err(
            new AnalysisUnsupportedTargetError(
              OPERATION,
              base.artifact.path,
              "Status file is missing its WSID or Program ID signature lines.",
            ),
          );
        return ok({
          ...base,
          format,
          status,
          limitations: [
            "Status sections without a parser rule are preserved verbatim in unparsed_lines.",
          ],
        });
      }
      case "br-source":
      case "br-procedure":
        return ok({
          ...base,
          format,
          source: indexBrSource(bytes.toString("latin1")),
          limitations: [
            "References are lexical observations; dynamic targets built from expressions remain null.",
          ],
        });
      case "br-screen":
        return ok({
          ...base,
          format,
          limitations: [
            "SCREEN fixed-record layout is not decoded; only identity and size are observed.",
          ],
        });
      case "br-config":
        return ok({
          ...base,
          format,
          config: indexBrConfig(bytes.toString("latin1")),
          limitations: [
            "Directive values are reported verbatim; BR runtime semantics are not evaluated.",
          ],
        });
    }
  }
}
