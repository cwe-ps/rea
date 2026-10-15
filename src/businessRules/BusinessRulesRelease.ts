/** In-process saved-LIST and execution-stream decoder; no Business Rules! runtime is launched or required. */
export const BUSINESS_RULES_PROVIDER_IDENTITY = {
  id: "business-rules-program",
  name: "REA Business Rules! program decoder",
  version: "saved-list-1+execution-stream-1",
} as const;

/** Complete-input budget; the largest observed compiled programs are under 3 MiB. */
export const BUSINESS_RULES_PROGRAM_LIMITS = {
  inputBytes: 64 * 1024 * 1024,
} as const;

/** In-process parser for BR artifacts: status files, source text, compiled-program observations, runtime configurations and screen definitions. */
export const BUSINESS_RULES_ARTIFACT_PROVIDER_IDENTITY = {
  id: "business-rules-artifact",
  name: "REA Business Rules! artifact parser",
  version:
    "status-1+source-text-1+compiled-observation-1+runtime-config-1+screen-1",
} as const;
