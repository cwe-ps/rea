import { BusinessRulesArtifactService } from "../application/businessRules/BusinessRulesArtifactService.js";
import { BusinessRulesArtifactProvider } from "../businessrules/BusinessRulesArtifactProvider.js";

/** Compose the built-in BR parser without import-time I/O. */
export const createBusinessRulesArtifactService =
  (): BusinessRulesArtifactService =>
    new BusinessRulesArtifactService(new BusinessRulesArtifactProvider());
