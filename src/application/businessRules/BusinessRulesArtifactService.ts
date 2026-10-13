import { isAbsolute } from "node:path";

import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { BusinessRulesArtifactPort } from "./BusinessRulesArtifactPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import {
  businessRulesArtifactSchema,
  inspectBusinessRulesArtifactInputSchema,
} from "../../domain/businessrules/businessRulesArtifact.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";

const OPERATION = "inspect_business_rules_artifact";

/** Shared CLI/MCP validation and Evidence composition for BR artifact inspection. */
export class BusinessRulesArtifactService {
  constructor(readonly provider: BusinessRulesArtifactPort) {}

  /** Parse one caller-selected BR artifact and bind the observation to Evidence. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const input = inspectBusinessRulesArtifactInputSchema.safeParse(rawInput);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(OPERATION, input.error.issues, rawInput, {
          cause: input.error,
        }),
      );
    if (!isAbsolute(input.data.path))
      return err(
        new AnalysisInputError(OPERATION, undefined, [
          {
            path: ["path"],
            reason: "invalid_format",
            message: "Expected an absolute filesystem path on this host.",
          },
        ]),
      );
    const inspected = await this.provider.inspect(input.data, options);
    if (!inspected.ok) return inspected;
    const report = businessRulesArtifactSchema.safeParse(inspected.value);
    if (!report.success || report.data.artifact.path !== input.data.path)
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Business Rules! parser returned malformed evidence or changed the selected artifact identity.",
        ),
      );
    const value = report.data;
    return ok(
      createEvidence(
        {
          path: value.artifact.path,
          sha256: value.artifact.sha256,
          format: value.format,
        },
        this.provider.identity,
        {
          operation: OPERATION,
          parameters: input.data,
          result: value,
          rawResult: value,
          confidence: "observed",
          limitations: value.limitations,
          locations: [{ kind: "artifact-path", path: value.artifact.path }],
        },
      ),
    );
  }
}
