import {
  businessRulesProgramSchema,
  inspectBusinessRulesProgramInputSchema,
} from "../../domain/businessRules/businessRulesProgram.js";
import {
  businessRulesArtifactSchema,
  inspectBusinessRulesArtifactInputSchema,
} from "../../domain/businessRules/businessRulesArtifact.js";
import type { ToolContract } from "../toolContractTypes.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";

/** Target-free Business Rules! inspection: compiled programs, runtime status files, runtime configurations, screen definitions and plain-text source. */
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
  {
    name: "inspect_business_rules_artifact",
    ...toolContractMetadata("inspect_business_rules_artifact"),
    kind: "artifact-provider",
    description:
      "Inspect an explicit local Business Rules! artifact without running it: a runtime status file, plain-text source, compiled program, WBCONFIG.SYS runtime configuration or SCREEN.* screen definition. classification.basis states how the format was determined (content-signature, extension-and-content or extension-only). Status files (ST-FILE.*, recognized by their WSID and Program ID lines) return the workstation, failing program and line, last BR and OS errors, loaded-program table, server/config/workfile/help paths, BRCONFIG drive assignments, open channels with their attribute lines and I/O retries; unrecognized lines are kept verbatim in status.unparsed_lines. Source text (.brs/.wbs/.prc, text saved under .br/.wb, or numbered BR statements) returns numbered lines with byte offsets, labels, and OPEN/CHAIN/EXECUTE/LIBRARY/DEF references derived with the same projection as compiled listings. Compiled programs (.br/.wb) return a structural observation only — header variant, raw header fields with their verification state, line-record byte patterns and printable string runs, all unverified — with decode_with pointing to inspect_business_rules_program for the full decoding. Runtime configurations (WBCONFIG.SYS) return directive lines with 1-based line numbers, skipping blank lines and REM/! comments. Screen definitions are identity and classification only (extension-only basis); their record layout is not decoded. Other files are unsupported targets.",
    inputSchema: inspectBusinessRulesArtifactInputSchema,
    outputSchema: evidenceResultOf(businessRulesArtifactSchema),
    examples: [
      {
        title: "Read a Business Rules! runtime status file",
        input: { path: "/runtime/ST-FILE.007" },
      },
      {
        title: "Index Business Rules! source references",
        input: { path: "/source/PAYROLL.brs" },
      },
      {
        title: "Index a WBCONFIG.SYS runtime configuration",
        input: { path: "/runtime/wbconfig.sys" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
