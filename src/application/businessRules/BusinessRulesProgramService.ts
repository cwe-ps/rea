import { isAbsolute } from "node:path";
import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { BusinessRulesProgramPort } from "./BusinessRulesProgramPort.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import {
  businessRulesProgramSchema,
  inspectBusinessRulesProgramInputSchema,
} from "../../domain/businessRules/businessRulesProgram.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";

const OPERATION = "inspect_business_rules_program";

/** Shared program-path validation and typed inline Evidence for CLI/MCP. */
export class BusinessRulesProgramService {
  constructor(readonly provider: BusinessRulesProgramPort) {}

  /** Bind the decoded header, listing and symbols to the selected file identity. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const input = inspectBusinessRulesProgramInputSchema.safeParse(rawInput);
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
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(OPERATION));
    const execution = inspected.value;
    const report = businessRulesProgramSchema.safeParse(execution.result);
    if (
      !report.success ||
      report.data.artifact.path !== input.data.path ||
      execution.subject?.path !== input.data.path ||
      execution.subject.sha256 !== report.data.artifact.sha256
    )
      return err(
        new AnalysisOutputError(
          OPERATION,
          "Business Rules! decoder returned malformed data or changed the selected program identity.",
        ),
      );
    return ok(
      createEvidence(execution.subject, execution.provider, {
        operation: OPERATION,
        parameters: input.data,
        result: report.data,
        ...(execution.rawResult === null
          ? {}
          : { rawResult: execution.rawResult }),
        confidence: "derived",
        locations: execution.locations,
        limitations: execution.limitations,
      }),
    );
  }
}
