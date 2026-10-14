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
      "Inspect an explicit local compiled Business Rules! program (.br/.wb) without running it. Decodes the modern big-endian or legacy little-endian header and section layout, reconstructs the numbered program listing from the saved LIST tokens (listing.basis saved-list), and reads modern symbol slots with array dimensions, function slots and string/numeric constants. OPEN/CHAIN/EXECUTE/LIBRARY/DEF references are derived from the decoded listing. Stripped programs whose saved LIST was removed are decompiled from the execution stream (listing.basis execution-stream): comments and labels are not stored there, output uses lowercase keywords and Title_Case identifiers, and undecoded instructions stay visible as <?...> markers listed in listing.unknown_markers. Stripped legacy-layout programs have no decoded listing; stripped_legacy reports their observed line-table chain, embedded DIM/DATA text and raw symbol-section strings. Unrecognized files are unsupported targets; damaged structures are reported, never guessed.",
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
