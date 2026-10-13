import {
  businessRulesArtifactSchema,
  inspectBusinessRulesArtifactInputSchema,
} from "../../domain/businessrules/businessRulesArtifact.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";

/** Offline Business Rules! artifact parsing; built-in, no external tools. */
export const BUSINESS_RULES_TOOL_CONTRACTS = [
  {
    name: "inspect_business_rules_artifact",
    ...toolContractMetadata("inspect_business_rules_artifact"),
    kind: "artifact-provider",
    description:
      "Inspect one explicit local Business Rules! (BR) artifact without executing it. Classifies compiled programs (.WB), line-numbered source (.brs/.wbs), procedure scripts (.prc), status/crash files (ST-FILE.*), screen definitions (SCREEN.*), and runtime configuration (WBCONFIG.SYS) by name and content, then parses the verifiable structure inline with artifact SHA-256 Evidence: compiled header variant and fields, line-number record candidates with offsets, and embedded printable strings; full status-file fields including the program chain table, drive assignments, and open files; source line numbers, DEF FN definitions, labels, and OPEN/CHAIN/EXECUTE references. Token-stream semantics, unverified header fields, dynamic reference targets, and the SCREEN record layout remain explicit unknowns. Built-in parser; no external provider or active target required.",
    inputSchema: inspectBusinessRulesArtifactInputSchema,
    outputSchema: evidenceResultOf(businessRulesArtifactSchema),
    examples: [
      {
        title: "Inspect a compiled BR program",
        input: { path: "/artifacts/ONQUTIL.WB" },
      },
      {
        title: "Inspect a BR status file",
        input: { path: "/artifacts/[WBWORK]ST-FILE.01" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
