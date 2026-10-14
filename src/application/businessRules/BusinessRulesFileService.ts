import { isAbsolute } from "node:path";
import type { z } from "zod";
import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { createEvidence, type Evidence } from "../../domain/evidence.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";

/** Replaceable in-process parser for one caller-selected Business Rules! file. */
export interface BusinessRulesFilePort {
  inspect(
    input: { readonly path: string },
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}

/** The named contract a file service validates against. */
export interface BusinessRulesFileContract<Report> {
  readonly operation: string;
  readonly inputSchema: z.ZodType<{ path: string }>;
  readonly resultSchema: z.ZodType<Report>;
  /** Evidence confidence of a validated report: printed fields are observed, decoded or projected ones derived. */
  readonly confidence: (report: Report) => "observed" | "derived";
}

/** Shared path validation and typed inline Evidence for CLI/MCP Business Rules! file tools. */
export class BusinessRulesFileService<
  Report extends { readonly artifact: { path: string; sha256: string } },
> {
  constructor(
    readonly contract: BusinessRulesFileContract<Report>,
    readonly provider: BusinessRulesFilePort,
  ) {}

  /** Bind the parsed result to the selected file identity. */
  async inspect(
    rawInput: unknown,
    options?: ExecutionOptions,
  ): Promise<Result<Evidence, AnalysisError>> {
    const { operation, inputSchema, resultSchema } = this.contract;
    if (options?.signal?.aborted)
      return err(new AnalysisCancelledError(operation));
    const input = inputSchema.safeParse(rawInput);
    if (!input.success)
      return err(
        analysisInputErrorFromIssues(operation, input.error.issues, rawInput, {
          cause: input.error,
        }),
      );
    if (!isAbsolute(input.data.path))
      return err(
        new AnalysisInputError(operation, undefined, [
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
      return err(new AnalysisCancelledError(operation));
    const execution = inspected.value;
    const report = resultSchema.safeParse(execution.result);
    if (
      !report.success ||
      report.data.artifact.path !== input.data.path ||
      execution.subject?.path !== input.data.path ||
      execution.subject.sha256 !== report.data.artifact.sha256
    )
      return err(
        new AnalysisOutputError(
          operation,
          "Business Rules! parser returned malformed data or changed the selected file identity.",
        ),
      );
    return ok(
      createEvidence(execution.subject, execution.provider, {
        operation,
        parameters: input.data,
        result: report.data,
        ...(execution.rawResult === null
          ? {}
          : { rawResult: execution.rawResult }),
        confidence: this.contract.confidence(report.data),
        locations: execution.locations,
        limitations: execution.limitations,
      }),
    );
  }
}
