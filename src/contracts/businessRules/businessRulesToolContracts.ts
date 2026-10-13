import {
  businessRulesProgramSchema,
  inspectBusinessRulesProgramInputSchema,
} from "../../domain/businessRules/businessRulesProgram.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";

/** Target-free compiled Business Rules! program inspection. */
export const BUSINESS_RULES_TOOL_CONTRACTS = [
  {
    name: "inspect_business_rules_program",
    ...toolContractMetadata("inspect_business_rules_program"),
    kind: "artifact-provider",
    description:
      "Inspect an explicit local compiled Business Rules! program (.br/.wb) without running it. Decodes the modern big-endian or legacy little-endian header and section layout, reconstructs the numbered program listing from the saved LIST tokens (listing.basis saved-list), and reads modern symbol slots with array dimensions, function slots and string/numeric constants. OPEN/CHAIN/LIBRARY/DEF references are derived from the decoded listing. Stripped programs whose saved LIST was removed still return header, symbols and constants, with listing.status absent and references unknown. Unrecognized files are unsupported targets; damaged structures are reported, never guessed.",
    inputSchema: inspectBusinessRulesProgramInputSchema,
    outputSchema: evidenceResultOf(businessRulesProgramSchema),
    examples: [
      {
        title: "Inspect a compiled Business Rules! program",
        input: { path: "/programs/PAYROLL.WB" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
