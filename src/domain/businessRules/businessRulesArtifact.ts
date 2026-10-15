import { z } from "zod";
import { businessRulesReferenceLists } from "./businessRulesProgram.js";

const byteOffset = z.number().int().nonnegative();
const physicalLine = z.number().int().min(1);
const programLine = z.number().int().min(0).max(99_999);

/** Select one Business Rules! artifact: compiled program, status file, runtime configuration, screen definition or plain-text source. */
export const inspectBusinessRulesArtifactInputSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .describe(
      "Absolute path to a caller-selected Business Rules! artifact: compiled program (.br/.wb), status file (ST-FILE.*), WBCONFIG.SYS runtime configuration, SCREEN.* screen definition or plain-text source (.brs/.wbs/.prc)",
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
  basis: z.enum([
    "content-signature",
    "extension-and-content",
    "extension-only",
  ]),
  detail: z.string().min(1),
});

/**
 * Raw header word with its verification state. `meaning` is "unknown" unless
 * the value was confirmed constant across the observed sample set.
 */
const compiledHeaderFieldSchema = z.strictObject({
  name: z.string().min(1),
  offset: byteOffset,
  width: z.number().int().min(1),
  value_hex: z.string().min(1),
  value: z.number().int().min(0).nullable(),
  meaning: z.string().min(1),
});

/** One observed line-number record candidate: marker byte 0x01/0x02 plus five ASCII digits. */
const compiledLineRecordSchema = z.strictObject({
  line: programLine,
  offset: byteOffset,
  marker: z.number().int().min(0).max(255),
});

/** Maximal strictly ascending run of line-record candidates in file order. */
const compiledLineSegmentSchema = z.strictObject({
  start_line: programLine,
  end_line: programLine,
  record_count: z.number().int().min(1),
  first_offset: byteOffset,
});

/** Raw printable byte run; an observation, not a confirmed string-table entry. */
const compiledStringRunSchema = z.strictObject({
  offset: byteOffset,
  text: z.string().min(1),
});

/**
 * Structural byte observations of a compiled program container, short of the
 * full decoding that `inspect_business_rules_program` performs.
 */
const businessRulesCompiledObservationSchema = z.strictObject({
  variant: z.enum(["modern", "legacy"]),
  header_fields: z.array(compiledHeaderFieldSchema),
  line_map: z.strictObject({
    record_count: z.number().int().min(0),
    segment_count: z.number().int().min(0),
    segments: z.array(compiledLineSegmentSchema),
    records: z.array(compiledLineRecordSchema),
  }),
  strings: z.strictObject({
    run_count: z.number().int().min(0),
    runs: z.array(compiledStringRunSchema),
  }),
});

/** Observed directive lines of a WBCONFIG.SYS runtime configuration. */
const businessRulesRuntimeConfigSchema = z.strictObject({
  directives: z.array(
    z.strictObject({
      line: physicalLine,
      keyword: z.string().min(1),
      text: z.string(),
    }),
  ),
});

/** One classified Business Rules! artifact and its parsed facet. */
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
  z.strictObject({
    artifact: artifactIdentity,
    format: z.literal("compiled-program"),
    classification,
    program: businessRulesCompiledObservationSchema,
    decode_with: z.literal("inspect_business_rules_program"),
    limitations: z.array(z.string()),
  }),
  z.strictObject({
    artifact: artifactIdentity,
    format: z.literal("runtime-config"),
    classification,
    config: businessRulesRuntimeConfigSchema,
    limitations: z.array(z.string()),
  }),
  z.strictObject({
    artifact: artifactIdentity,
    format: z.literal("screen-file"),
    classification,
    limitations: z.array(z.string()),
  }),
]);

export type InspectBusinessRulesArtifactInput = z.infer<
  typeof inspectBusinessRulesArtifactInputSchema
>;
export type BusinessRulesArtifact = z.infer<typeof businessRulesArtifactSchema>;
export type BusinessRulesStatus = z.infer<typeof businessRulesStatusSchema>;
export type BusinessRulesSource = z.infer<typeof businessRulesSourceSchema>;
export type BusinessRulesCompiledObservation = z.infer<
  typeof businessRulesCompiledObservationSchema
>;
export type BusinessRulesRuntimeConfig = z.infer<
  typeof businessRulesRuntimeConfigSchema
>;
