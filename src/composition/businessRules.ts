import { BusinessRulesFileService } from "../application/businessRules/BusinessRulesFileService.js";
import { BusinessRulesArtifactProvider } from "../businessRules/BusinessRulesArtifactProvider.js";
import { BusinessRulesProgramProvider } from "../businessRules/BusinessRulesProgramProvider.js";
import {
  businessRulesArtifactSchema,
  inspectBusinessRulesArtifactInputSchema,
  type BusinessRulesArtifact,
} from "../domain/businessRules/businessRulesArtifact.js";
import {
  businessRulesProgramSchema,
  inspectBusinessRulesProgramInputSchema,
  type BusinessRulesProgram,
} from "../domain/businessRules/businessRulesProgram.js";

/** Compiled-program decoding service. */
export type BusinessRulesProgramService =
  BusinessRulesFileService<BusinessRulesProgram>;

/** Status-file, source, runtime-config, screen and compiled-observation parsing service. */
export type BusinessRulesArtifactService =
  BusinessRulesFileService<BusinessRulesArtifact>;

/** Compose the in-process compiled-program decoder without import-time I/O. */
export const createBusinessRulesProgramService =
  (): BusinessRulesProgramService =>
    new BusinessRulesFileService(
      {
        operation: "inspect_business_rules_program",
        inputSchema: inspectBusinessRulesProgramInputSchema,
        resultSchema: businessRulesProgramSchema,
        confidence: () => "derived",
      },
      new BusinessRulesProgramProvider(),
    );

/** Compose the in-process artifact parser without import-time I/O. */
export const createBusinessRulesArtifactService =
  (): BusinessRulesArtifactService =>
    new BusinessRulesFileService(
      {
        operation: "inspect_business_rules_artifact",
        inputSchema: inspectBusinessRulesArtifactInputSchema,
        resultSchema: businessRulesArtifactSchema,
        confidence: (report) =>
          report.format === "source-text" ? "derived" : "observed",
      },
      new BusinessRulesArtifactProvider(),
    );
