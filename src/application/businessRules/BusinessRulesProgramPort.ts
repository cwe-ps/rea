import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { InspectBusinessRulesProgramInput } from "../../domain/businessRules/businessRulesProgram.js";
import type { Result } from "../../domain/result.js";

/** Replaceable compiled-program decoder, independent of any Business Rules! runtime. */
export interface BusinessRulesProgramPort {
  inspect(
    input: InspectBusinessRulesProgramInput,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>>;
}
