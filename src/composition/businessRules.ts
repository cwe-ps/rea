import { BusinessRulesProgramService } from "../application/businessRules/BusinessRulesProgramService.js";
import { BusinessRulesProgramProvider } from "../businessRules/BusinessRulesProgramProvider.js";

/** Compose the in-process compiled-program decoder without import-time I/O. */
export const createBusinessRulesProgramService =
  (): BusinessRulesProgramService =>
    new BusinessRulesProgramService(new BusinessRulesProgramProvider());
