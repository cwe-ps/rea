import type { ExecutionOptions } from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { BusinessRulesArtifact } from "../../domain/businessrules/businessRulesArtifact.js";
import type { Result } from "../../domain/result.js";

/** Provider identity fields required for Evidence attribution. */
export interface BusinessRulesArtifactProviderIdentity {
  readonly id: string;
  readonly name: string;
  readonly version: string | null;
}

/** Boundary to a Business Rules! artifact parser implementation. */
export interface BusinessRulesArtifactPort {
  readonly identity: BusinessRulesArtifactProviderIdentity;
  inspect(
    input: { readonly path: string },
    options?: ExecutionOptions,
  ): Promise<Result<BusinessRulesArtifact, AnalysisError>>;
}
