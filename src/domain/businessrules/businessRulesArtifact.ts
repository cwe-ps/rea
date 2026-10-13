import { z } from "zod";

import { businessRulesFormatSchema } from "./businessRulesFormat.js";

/** Explicit local BR artifact selection, independent of an active target. */
export const inspectBusinessRulesArtifactInputSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .describe("Absolute filesystem path to the selected BR artifact"),
});

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const offsetSchema = z.number().int().min(0);

const artifactSchema = z.strictObject({
  path: z.string().min(1),
  sha256: sha256Schema,
  bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const classificationSchema = z.strictObject({
  basis: z.enum([
    "content-signature",
    "extension-and-content",
    "extension-only",
  ]),
  detail: z.string().min(1),
});

/**
 * Raw header word with its verification state. `meaning` is "unknown" unless
 * the value was confirmed constant across the full real sample set.
 */
const headerFieldSchema = z.strictObject({
  name: z.string().min(1),
  offset: offsetSchema,
  width: z.number().int().min(1),
  value_hex: z.string().min(1),
  value: z.number().int().min(0).nullable(),
  meaning: z.string().min(1),
});

/** One observed line-number record: marker byte 0x01/0x02 plus 5 ASCII digits. */
const lineRecordSchema = z.strictObject({
  line: z.number().int().min(0),
  offset: offsetSchema,
  marker: z.number().int().min(0).max(255),
});

/** Maximal ascending run of line-number records in file order. */
const lineSegmentSchema = z.strictObject({
  start_line: z.number().int().min(0),
  end_line: z.number().int().min(0),
  record_count: z.number().int().min(1),
  first_offset: offsetSchema,
});

/** Raw printable byte run; an observation, not a confirmed string-table entry. */
const stringRunSchema = z.strictObject({
  offset: offsetSchema,
  text: z.string().min(1),
});

/** Structural observations of a compiled BR program (.WB). */
const compiledProgramSchema = z.strictObject({
  variant: z.enum(["A", "B"]),
  header_fields: z.array(headerFieldSchema),
  line_map: z.strictObject({
    record_count: z.number().int().min(0),
    segment_count: z.number().int().min(0),
    segments: z.array(lineSegmentSchema),
    records: z.array(lineRecordSchema),
  }),
  strings: z.strictObject({
    run_count: z.number().int().min(0),
    runs: z.array(stringRunSchema),
  }),
});

/** One program in the ST-FILE chain/session table. */
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

/** Structured extraction of a BR status/crash file (ST-FILE). */
const statusFileSchema = z.strictObject({
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
  unparsed_lines: z.array(z.string()),
});

/** One DEF FN definition; end_line is the matching FNEND when observed. */
const sourceFunctionSchema = z.strictObject({
  name: z.string().min(1),
  line: z.number().int().min(0).nullable(),
  end_line: z.number().int().min(0).nullable(),
  parameters: z.string(),
});

/** One statement label (name followed by a colon). */
const sourceLabelSchema = z.strictObject({
  name: z.string().min(1),
  line: z.number().int().min(0).nullable(),
});

/** One OPEN # / CHAIN / EXECUTE target reference with its source location. */
const sourceReferenceSchema = z.strictObject({
  kind: z.enum(["open", "chain", "execute"]),
  line: z.number().int().min(0).nullable(),
  statement: z.number().int().min(1),
  channel: z.number().int().min(0).nullable(),
  target: z.string().nullable(),
  detail: z.string(),
});

/** Line-oriented index of BR source (.brs/.wbs) or a procedure script (.prc). */
const sourceIndexSchema = z.strictObject({
  numbered_line_count: z.number().int().min(0),
  numbered_lines: z.array(
    z.strictObject({ line: z.number().int().min(0), offset: offsetSchema }),
  ),
  functions: z.array(sourceFunctionSchema),
  labels: z.array(sourceLabelSchema),
  references: z.array(sourceReferenceSchema),
});

/** Observed directive lines of a WBCONFIG.SYS runtime configuration. */
const configIndexSchema = z.strictObject({
  directives: z.array(
    z.strictObject({
      line: z.number().int().min(1),
      keyword: z.string().min(1),
      text: z.string(),
    }),
  ),
});

const baseShape = {
  artifact: artifactSchema,
  classification: classificationSchema,
  limitations: z.array(z.string()),
};

/** Business Rules! artifact inspection result, discriminated by format. */
export const businessRulesArtifactSchema = z.discriminatedUnion("format", [
  z.strictObject({
    ...baseShape,
    format: z.literal("br-compiled"),
    program: compiledProgramSchema,
  }),
  z.strictObject({
    ...baseShape,
    format: z.literal("br-status"),
    status: statusFileSchema,
  }),
  z.strictObject({
    ...baseShape,
    format: z.literal("br-source"),
    source: sourceIndexSchema,
  }),
  z.strictObject({
    ...baseShape,
    format: z.literal("br-procedure"),
    source: sourceIndexSchema,
  }),
  z.strictObject({ ...baseShape, format: z.literal("br-screen") }),
  z.strictObject({
    ...baseShape,
    format: z.literal("br-config"),
    config: configIndexSchema,
  }),
]);

/** Parsed BR artifact inspection result. */
export type BusinessRulesArtifact = z.infer<typeof businessRulesArtifactSchema>;

export { businessRulesFormatSchema };
