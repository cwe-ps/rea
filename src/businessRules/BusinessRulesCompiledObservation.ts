import type { BusinessRulesCompiledObservation } from "../domain/businessRules/businessRulesArtifact.js";
import { sniffBusinessRulesHeaderVariant } from "./BusinessRulesDecoder.js";

type HeaderField = BusinessRulesCompiledObservation["header_fields"][number];
type LineRecord =
  BusinessRulesCompiledObservation["line_map"]["records"][number];
type LineSegment =
  BusinessRulesCompiledObservation["line_map"]["segments"][number];
type StringRun = BusinessRulesCompiledObservation["strings"]["runs"][number];

/**
 * Attached to every compiled-program observation. Header fields beyond the
 * variant signature are unverified observations whose meanings remain unknown;
 * the token stream is not decoded; line records are byte-pattern observations
 * (marker 0x01/0x02 plus five ASCII digits not followed by a sixth digit)
 * whose marker semantics are unknown; printable runs are raw byte
 * observations, not confirmed string-table entries.
 */
export const COMPILED_OBSERVATION_LIMITATIONS = [
  "Header fields beyond the variant signature are unverified observations; their meanings remain unknown.",
  "The token stream is not decoded; statement semantics remain unknown.",
  "Line records are byte-pattern observations (marker 0x01/0x02 plus five ASCII digits not followed by a sixth digit); on paired source/program samples they formed a subset of the source statement lines, and marker-byte semantics are unknown.",
  "Printable runs are raw byte observations, not confirmed string-table entries.",
  "Full decoding of the section layout, listing, symbols and references is available from inspect_business_rules_program.",
] as const;

/**
 * Caps on the returned observation lists, bounding result size on large
 * programs. Counts and `_omitted` fields always reflect the full scan.
 */
export const COMPILED_OBSERVATION_CAPS = {
  lineRecords: 4096,
  lineSegments: 4096,
  stringRuns: 2048,
} as const;

/** Limitations naming every list capped by COMPILED_OBSERVATION_CAPS. */
export const compiledObservationTruncationLimitations = (
  program: BusinessRulesCompiledObservation,
): string[] => {
  const limitations: string[] = [];
  if (program.line_map.records_omitted > 0)
    limitations.push(
      `line_map.records is capped at ${COMPILED_OBSERVATION_CAPS.lineRecords} entries (${program.line_map.records_omitted} omitted); record_count reflects the full scan.`,
    );
  if (program.line_map.segments_omitted > 0)
    limitations.push(
      `line_map.segments is capped at ${COMPILED_OBSERVATION_CAPS.lineSegments} entries (${program.line_map.segments_omitted} omitted); segment_count reflects the full scan.`,
    );
  if (program.strings.runs_omitted > 0)
    limitations.push(
      `strings.runs is capped at ${COMPILED_OBSERVATION_CAPS.stringRuns} entries (${program.strings.runs_omitted} omitted); run_count reflects the full scan.`,
    );
  return limitations;
};

const hexField = (
  data: Uint8Array,
  offset: number,
  width: number,
): string | null =>
  offset + width <= data.length
    ? Array.from(data.subarray(offset, offset + width), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
    : null;

const field = (
  data: Uint8Array,
  name: string,
  offset: number,
  width: number,
  value: number | null,
  meaning: string,
): HeaderField | null => {
  const valueHex = hexField(data, offset, width);
  if (valueHex === null) return null;
  return { name, offset, width, value_hex: valueHex, value, meaning };
};

const UNKNOWN = "unknown";

/**
 * Two-byte marker read from the bytes; the meaning states whether the value
 * matches the constant observed across samples rather than assuming it.
 */
const markerField = (
  data: Uint8Array,
  name: string,
  offset: number,
  expected: number,
): HeaderField | null => {
  const valueHex = hexField(data, offset, 2);
  if (valueHex === null) return null;
  const value = Number.parseInt(valueHex, 16);
  return {
    name,
    offset,
    width: 2,
    value_hex: valueHex,
    value,
    meaning:
      value === expected
        ? "matches the marker observed as constant across samples"
        : `differs from the marker observed as constant across samples (0x${expected.toString(16)})`,
  };
};

const modernHeaderFields = (data: Uint8Array): HeaderField[] =>
  [
    field(
      data,
      "signature_0x00",
      0,
      4,
      0x33,
      "signature confirmed by the variant check",
    ),
    field(data, "word_0x04_be32", 4, 4, null, UNKNOWN),
    field(data, "version_0x08", 8, 3, null, "observed constant version marker"),
    field(data, "flags_0x0b", 11, 1, null, UNKNOWN),
    ...[12, 16, 20, 24, 28, 32, 36, 40].map((offset) =>
      field(
        data,
        `word_0x${offset.toString(16)}_be32`,
        offset,
        4,
        null,
        UNKNOWN,
      ),
    ),
    field(data, "word_0x2c_be16", 44, 2, null, UNKNOWN),
    markerField(data, "marker_0x2e", 46, 0x0118),
  ].filter((entry) => entry !== null);

const legacyHeaderFields = (data: Uint8Array): HeaderField[] =>
  [
    field(data, "word_0x00_le32", 0, 4, null, UNKNOWN),
    field(
      data,
      "word_0x04_le32",
      4,
      4,
      null,
      "unknown; when nonzero it pointed into a region of embedded variable-name strings in observed samples",
    ),
    field(
      data,
      "signature_0x08",
      8,
      1,
      0x0a,
      "signature confirmed by the variant check",
    ),
    field(data, "byte_0x09", 9, 1, null, UNKNOWN),
    field(data, "word_0x0a", 10, 2, null, UNKNOWN),
    markerField(data, "marker_0x0c", 12, 0x0118),
    field(data, "word_0x10_le32", 16, 4, null, UNKNOWN),
    field(
      data,
      "word_0x14_le32",
      20,
      4,
      data.length >= 24
        ? new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
            20,
            true,
          )
        : null,
      "observed as little-endian 30 or 32 across all sampled legacy programs",
    ),
  ].filter((entry) => entry !== null);

const isDigit = (byte: number): boolean => byte >= 0x30 && byte <= 0x39;

/** Scan marker byte 0x01/0x02 followed by five ASCII digits and no sixth digit. */
const scanLineRecords = (data: Uint8Array): LineRecord[] => {
  const records: LineRecord[] = [];
  for (let offset = 0; offset + 6 <= data.length; offset += 1) {
    const marker = data[offset];
    if (marker !== 0x01 && marker !== 0x02) continue;
    if (
      isDigit(data[offset + 1] ?? 0) &&
      isDigit(data[offset + 2] ?? 0) &&
      isDigit(data[offset + 3] ?? 0) &&
      isDigit(data[offset + 4] ?? 0) &&
      isDigit(data[offset + 5] ?? 0) &&
      !isDigit(data[offset + 6] ?? 0)
    )
      records.push({
        line: Number(
          String.fromCharCode(
            data[offset + 1] ?? 0x30,
            data[offset + 2] ?? 0x30,
            data[offset + 3] ?? 0x30,
            data[offset + 4] ?? 0x30,
            data[offset + 5] ?? 0x30,
          ),
        ),
        offset,
        marker,
      });
  }
  return records;
};

/** Group file-ordered records into maximal strictly ascending runs. */
const segmentsOf = (records: readonly LineRecord[]): LineSegment[] => {
  const segments: LineSegment[] = [];
  for (const record of records) {
    const current = segments.at(-1);
    if (current !== undefined && record.line > current.end_line) {
      current.end_line = record.line;
      current.record_count += 1;
    } else {
      segments.push({
        start_line: record.line,
        end_line: record.line,
        record_count: 1,
        first_offset: record.offset,
      });
    }
  }
  return segments;
};

/** Extract printable ASCII runs of at least four bytes with their offsets. */
const scanStringRuns = (data: Uint8Array): StringRun[] => {
  const runs: StringRun[] = [];
  let start: number | undefined;
  for (let offset = 0; offset <= data.length; offset += 1) {
    const byte = data[offset];
    const printable = byte !== undefined && byte >= 0x20 && byte <= 0x7e;
    if (printable && start === undefined) start = offset;
    if (!printable && start !== undefined) {
      if (offset - start >= 4) {
        let text = "";
        for (let index = start; index < offset; index += 1)
          text += String.fromCharCode(data[index] ?? 0x20);
        runs.push({ offset: start, text });
      }
      start = undefined;
    }
  }
  return runs;
};

/**
 * Observe the verifiable structure of a compiled BR program without decoding
 * it: the header variant and its raw fields, line-number record candidates,
 * and embedded printable runs. Lists are capped at COMPILED_OBSERVATION_CAPS
 * with the totals in the counts and the difference in the `_omitted` fields.
 * Returns null when no variant signature matches.
 */
export const observeBusinessRulesCompiledProgram = (
  data: Uint8Array,
): BusinessRulesCompiledObservation | null => {
  const variant = sniffBusinessRulesHeaderVariant(data);
  if (variant === undefined) return null;
  const records = scanLineRecords(data);
  const segments = segmentsOf(records);
  const runs = scanStringRuns(data);
  return {
    variant,
    header_fields:
      variant === "modern"
        ? modernHeaderFields(data)
        : legacyHeaderFields(data),
    line_map: {
      record_count: records.length,
      segment_count: segments.length,
      segments_omitted: Math.max(
        segments.length - COMPILED_OBSERVATION_CAPS.lineSegments,
        0,
      ),
      segments: segments.slice(0, COMPILED_OBSERVATION_CAPS.lineSegments),
      records_omitted: Math.max(
        records.length - COMPILED_OBSERVATION_CAPS.lineRecords,
        0,
      ),
      records: records.slice(0, COMPILED_OBSERVATION_CAPS.lineRecords),
    },
    strings: {
      run_count: runs.length,
      runs_omitted: Math.max(
        runs.length - COMPILED_OBSERVATION_CAPS.stringRuns,
        0,
      ),
      runs: runs.slice(0, COMPILED_OBSERVATION_CAPS.stringRuns),
    },
  };
};
