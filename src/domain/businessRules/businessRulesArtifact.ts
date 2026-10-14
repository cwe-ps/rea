import { z } from "zod";
import { businessRulesReferenceLists } from "./businessRulesProgram.js";

const byteOffset = z.number().int().nonnegative();
const physicalLine = z.number().int().min(1);
const programLine = z.number().int().min(0).max(99_999);

/** Select one Business Rules! runtime status file or plain-text source file. */
export const inspectBusinessRulesArtifactInputSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .describe(
      "Absolute path to a caller-selected Business Rules! status file (ST-FILE.*) or plain-text source (.brs/.wbs/.prc)",
    ),
});

/** One program in a status file's loaded-program table, as printed. */
const statusProgramSchema = z.strictObject({
  path: z.string().min(1),
  class: z.string().min(1),
  state: z.string().min(1),
  run_state: z.string().min(1),
  links: z.number().int().min(0),
});

/** One BRCONFIG drive assignment row from a status file. */
const driveAssignmentSchema = z.strictObject({
  logical_drive: z.string().min(1),
  physical_path: z.string(),
  shared_name: z.string(),
  current_directory: z.string(),
});

/** One open channel recorded in a status file, with its raw attribute line. */
const statusOpenFileSchema = z.strictObject({
  channel: z.number().int().min(0),
  name: z.string(),
  attributes: z.string().nullable(),
});

/**
 * Fields read from a BR runtime status/crash file. Absent sections are null
 * or empty; lines no rule consumed are kept verbatim with their line number.
 */
const businessRulesStatusSchema = z.strictObject({
  wsid: z.number().int().min(0),
  date: z.string().min(1),
  time: z.string().min(1),
  program_id: z.string().min(1),
  current_line: z.number().int().min(0).nullable(),
  last_error: z.number().int().min(0).nullable(),
  error_line: z.string().nullable(),
  last_os_error: z.number().int().nullable(),
  programs: z.array(statusProgramSchema),
  server_file: z.string().nullable(),
  br_config_file: z.string().nullable(),
  workfile_path: z.string().nullable(),
  help_path: z.string().nullable(),
  drive_assignments: z.array(driveAssignmentSchema),
  open_files: z.array(statusOpenFileSchema),
  io_retries: z.number().int().min(0).nullable(),
  unparsed_lines: z.array(
    z.strictObject({ line: physicalLine, text: z.string() }),
  ),
});

/**
 * Lexical index of plain-text BR source. `line` is the BR line number (null
 * in unnumbered procedure scripts); `physical_line` is the 1-based text line
 * where that numbered line starts.
 */
const businessRulesSourceSchema = z.strictObject({
  numbering: z.enum(["numbered", "unnumbered", "mixed"]),
  physical_lines: z.number().int().min(0),
  lines: z.array(
    z.strictObject({
      number: programLine,
      physical_line: physicalLine,
      offset: byteOffset,
    }),
  ),
  labels: z.array(
    z.strictObject({
      name: z.string().min(1),
      line: programLine.nullable(),
      physical_line: physicalLine,
    }),
  ),
  references: z.strictObject({
    evidence_kind: z.literal("derived"),
    ...businessRulesReferenceLists({
      line: programLine.nullable(),
      physical_line: physicalLine,
    }),
  }),
});

const artifactIdentity = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: byteOffset,
});

const classification = z.strictObject({
  basis: z.enum(["content-signature", "extension-and-content"]),
  detail: z.string().min(1),
});

/** One classified non-compiled Business Rules! artifact and its parsed facet. */
export const businessRulesArtifactSchema = z.discriminatedUnion("format", [
  z.strictObject({
    artifact: artifactIdentity,
    format: z.literal("status-file"),
    classification,
    status: businessRulesStatusSchema,
    limitations: z.array(z.string()),
  }),
  z.strictObject({
    artifact: artifactIdentity,
    format: z.literal("source-text"),
    classification,
    source: businessRulesSourceSchema,
    limitations: z.array(z.string()),
  }),
]);

export type InspectBusinessRulesArtifactInput = z.infer<
  typeof inspectBusinessRulesArtifactInputSchema
>;
export type BusinessRulesArtifact = z.infer<typeof businessRulesArtifactSchema>;
export type BusinessRulesStatus = z.infer<typeof businessRulesStatusSchema>;
export type BusinessRulesSource = z.infer<typeof businessRulesSourceSchema>;
