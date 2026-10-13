import type { BusinessRulesArtifact } from "../domain/businessrules/businessRulesArtifact.js";
import { sniffWbVariant } from "../domain/businessrules/businessRulesFormat.js";

type CompiledProgram = Extract<
  BusinessRulesArtifact,
  { format: "br-compiled" }
>["program"];

type HeaderField = CompiledProgram["header_fields"][number];

const COMPILED_LIMITATIONS = [
  "Header fields beyond the variant signature are unverified observations; their meanings remain unknown.",
  "The token stream is not decoded; statement semantics remain unknown.",
  "Line records are byte-pattern observations (marker 0x01/0x02 plus five ASCII digits); on paired source/program samples they formed a subset of the source statement lines, and marker-byte semantics are unknown.",
  "Printable runs are raw byte observations, not confirmed string-table entries.",
];

/** Limitations attached to every compiled-program observation. */
export const wbProgramLimitations = (): string[] => [...COMPILED_LIMITATIONS];

const hexField = (
  bytes: Buffer,
  offset: number,
  width: number,
): string | null =>
  offset + width <= bytes.length
    ? bytes.subarray(offset, offset + width).toString("hex")
    : null;

const field = (
  bytes: Buffer,
  name: string,
  offset: number,
  width: number,
  value: number | null,
  meaning: string,
): HeaderField | null => {
  const valueHex = hexField(bytes, offset, width);
  if (valueHex === null) return null;
  return { name, offset, width, value_hex: valueHex, value, meaning };
};

const UNKNOWN = "unknown";

const variantAHeaderFields = (bytes: Buffer): HeaderField[] =>
  [
    field(bytes, "signature_0x00", 0, 4, 0x33, "observed constant signature"),
    field(bytes, "word_0x04_be32", 4, 4, null, UNKNOWN),
    field(
      bytes,
      "version_0x08",
      8,
      3,
      null,
      "observed constant version marker",
    ),
    field(bytes, "flags_0x0b", 11, 1, null, UNKNOWN),
    ...[12, 16, 20, 24, 28, 32, 36, 40].map((offset) =>
      field(
        bytes,
        `word_0x${offset.toString(16)}_be32`,
        offset,
        4,
        null,
        UNKNOWN,
      ),
    ),
    field(bytes, "word_0x2c_be16", 44, 2, null, UNKNOWN),
    field(bytes, "marker_0x2e", 46, 2, 0x0118, "observed constant marker"),
  ].filter((entry) => entry !== null);

const variantBHeaderFields = (bytes: Buffer): HeaderField[] =>
  [
    field(bytes, "word_0x00_le32", 0, 4, null, UNKNOWN),
    field(
      bytes,
      "word_0x04_le32",
      4,
      4,
      null,
      "unknown; when nonzero it pointed into a region of embedded variable-name strings in observed samples",
    ),
    field(bytes, "signature_0x08", 8, 1, 0x0a, "observed constant signature"),
    field(bytes, "byte_0x09", 9, 1, null, UNKNOWN),
    field(bytes, "word_0x0a", 10, 2, null, UNKNOWN),
    field(bytes, "marker_0x0c", 12, 2, 0x0118, "observed constant marker"),
    field(bytes, "word_0x10_le32", 16, 4, null, UNKNOWN),
    field(
      bytes,
      "word_0x14_le32",
      20,
      4,
      bytes.length >= 24 ? bytes.readUInt32LE(20) : null,
      "observed as little-endian 30 or 32 across all sampled variant-B programs",
    ),
  ].filter((entry) => entry !== null);

const isDigit = (byte: number): boolean => byte >= 0x30 && byte <= 0x39;

/** Scan marker byte 0x01/0x02 followed by exactly five ASCII digits. */
const scanLineRecords = (
  bytes: Buffer,
): CompiledProgram["line_map"]["records"] => {
  const records: CompiledProgram["line_map"]["records"] = [];
  for (let offset = 0; offset + 6 <= bytes.length; offset += 1) {
    const marker = bytes[offset];
    if (marker !== 0x01 && marker !== 0x02) continue;
    if (
      isDigit(bytes[offset + 1] ?? 0) &&
      isDigit(bytes[offset + 2] ?? 0) &&
      isDigit(bytes[offset + 3] ?? 0) &&
      isDigit(bytes[offset + 4] ?? 0) &&
      isDigit(bytes[offset + 5] ?? 0)
    )
      records.push({
        line: Number(bytes.toString("ascii", offset + 1, offset + 6)),
        offset,
        marker,
      });
  }
  return records;
};

/** Group file-ordered records into maximal strictly ascending runs. */
const segmentsOf = (
  records: CompiledProgram["line_map"]["records"],
): CompiledProgram["line_map"]["segments"] => {
  const segments: CompiledProgram["line_map"]["segments"] = [];
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
const scanStringRuns = (bytes: Buffer): CompiledProgram["strings"]["runs"] => {
  const runs: CompiledProgram["strings"]["runs"] = [];
  let start: number | undefined;
  for (let offset = 0; offset <= bytes.length; offset += 1) {
    const byte = bytes[offset];
    const printable = byte !== undefined && byte >= 0x20 && byte <= 0x7e;
    if (printable && start === undefined) start = offset;
    if (!printable && start !== undefined) {
      if (offset - start >= 4)
        runs.push({
          offset: start,
          text: bytes.toString("ascii", start, offset),
        });
      start = undefined;
    }
  }
  return runs;
};

/**
 * Parse the verifiable structure of a compiled BR program: variant header,
 * line-number record candidates, and embedded printable runs.
 */
export const parseWbProgram = (bytes: Buffer): CompiledProgram | null => {
  const variant = sniffWbVariant(bytes);
  if (variant === undefined) return null;
  const records = scanLineRecords(bytes);
  const segments = segmentsOf(records);
  const runs = scanStringRuns(bytes);
  return {
    variant,
    header_fields:
      variant === "A"
        ? variantAHeaderFields(bytes)
        : variantBHeaderFields(bytes),
    line_map: {
      record_count: records.length,
      segment_count: segments.length,
      segments,
      records,
    },
    strings: { run_count: runs.length, runs },
  };
};
