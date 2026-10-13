/** In-process saved-LIST decoder; no Business Rules! runtime is launched or required. */
export const BUSINESS_RULES_PROVIDER_IDENTITY = {
  id: "business-rules-program",
  name: "REA Business Rules! program decoder",
  version: "saved-list-1",
} as const;

/** Complete-input budget; the largest observed compiled programs are under 3 MiB. */
export const BUSINESS_RULES_PROGRAM_LIMITS = {
  inputBytes: 64 * 1024 * 1024,
} as const;
