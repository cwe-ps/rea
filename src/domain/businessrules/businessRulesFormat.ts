import { z } from "zod";

/**
 * Business Rules! (BR) artifact formats recognized from paths and content.
 * Signatures were verified against 1201 compiled programs, status files,
 * sources, procedure scripts, screen records, and runtime configurations from
 * one real Collection-Master installation; nothing here executes BR code.
 */
export const BUSINESS_RULES_FORMATS = [
  "br-compiled",
  "br-source",
  "br-status",
  "br-procedure",
  "br-screen",
  "br-config",
] as const;

/** Zod schema for the recognized BR artifact formats. */
export const businessRulesFormatSchema = z.enum(BUSINESS_RULES_FORMATS);

/** Parsed BR artifact format. */
export type BusinessRulesFormat = z.infer<typeof businessRulesFormatSchema>;

/** Type guard for the BR format vocabulary. */
export const isBusinessRulesFormat = (
  value: string,
): value is BusinessRulesFormat =>
  (BUSINESS_RULES_FORMATS as readonly string[]).includes(value);

const basenameOf = (path: string): string =>
  path.split("/").at(-1)?.toLowerCase() ?? "";

/** Classify a path by BR naming conventions; content confirmation is separate. */
export const classifyBusinessRulesPath = (
  path: string,
): BusinessRulesFormat | undefined => {
  const lower = path.toLowerCase();
  const basename = basenameOf(path);
  if (lower.endsWith(".wb")) return "br-compiled";
  if (lower.endsWith(".brs") || lower.endsWith(".wbs")) return "br-source";
  if (lower.endsWith(".prc")) return "br-procedure";
  if (basename === "wbconfig.sys") return "br-config";
  if (/^(?:\[wbwork\])?st-file\.\d+$/u.test(basename)) return "br-status";
  if (/^screen\.\d+$/u.test(basename)) return "br-screen";
  return undefined;
};

/** Compiled-program header variants observed across the full sample set. */
export type WbVariant = "A" | "B";

const WB_A_MAGIC = [0x00, 0x00, 0x00, 0x33] as const;
const WB_A_VERSION = [0x0c, 0x26, 0x03] as const;

/**
 * Sniff the compiled-program header variant. Variant A carries
 * 00 00 00 33 at offset 0, 0c 26 03 at offset 8, and 01 18 at offset 46;
 * variant B carries 0a at offset 8, 01 18 at offset 12, and 30 or 32 as u32le
 * at offset 20.
 */
export const sniffWbVariant = (prefix: Buffer): WbVariant | undefined => {
  if (
    prefix.length >= 11 &&
    WB_A_MAGIC.every((byte, index) => prefix[index] === byte) &&
    WB_A_VERSION.every((byte, index) => prefix[index + 8] === byte) &&
    (prefix.length < 48 || (prefix[46] === 0x01 && prefix[47] === 0x18))
  )
    return "A";
  if (
    prefix.length >= 24 &&
    prefix[8] === 0x0a &&
    prefix[12] === 0x01 &&
    prefix[13] === 0x18 &&
    [30, 32].includes(prefix.readUInt32LE(20))
  )
    return "B";
  return undefined;
};

/** True when every prefix byte is printable text or a common text control. */
export const looksLikeText = (prefix: Buffer): boolean =>
  prefix.every(
    (byte) => byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d,
  );

const STATUS_PREFIX = /^\s*WSID=/u;
const NUMBERED_SOURCE_LINE = /^\s*\d{1,5}[ \t]+\S/mu;
const BR_KEYWORD =
  /\b(?:DIM|PRINT|INPUT|CHAIN|EXECUTE|GOTO|GOSUB|FNEND|REREAD|REWRITE|DEF\s+FN)\b|(?:OPEN|READ|WRITE)\s+#\d+/u;

/** Sniff BR content independent of the path; text formats need strong markers. */
export const sniffBusinessRulesContent = (
  prefix: Buffer,
): BusinessRulesFormat | undefined => {
  if (sniffWbVariant(prefix) !== undefined) return "br-compiled";
  if (looksLikeText(prefix)) {
    const text = prefix.toString("latin1");
    if (STATUS_PREFIX.test(text) && text.includes("Program ID "))
      return "br-status";
    if (NUMBERED_SOURCE_LINE.test(text) && BR_KEYWORD.test(text))
      return "br-source";
  }
  return undefined;
};

/**
 * Confirm or demote a path-based BR classification using content bytes.
 * Plaintext saved under a compiled-program name is reported as source; a
 * misnamed binary drops to a plain file.
 */
export const confirmBusinessRulesFormat = (
  pathFormat: BusinessRulesFormat,
  prefix: Buffer,
): BusinessRulesFormat | "file" => {
  switch (pathFormat) {
    case "br-compiled":
      if (sniffWbVariant(prefix) !== undefined) return "br-compiled";
      return looksLikeText(prefix) ? "br-source" : "file";
    case "br-status":
      return sniffBusinessRulesContent(prefix) === "br-status"
        ? "br-status"
        : "file";
    case "br-screen":
      // Fixed-record screen definitions carry no verified magic bytes.
      return "br-screen";
    case "br-source":
    case "br-procedure":
    case "br-config":
      return looksLikeText(prefix) ? pathFormat : "file";
  }
};

/** How a BR classification was established, weakest to strongest. */
export type BusinessRulesClassificationBasis =
  | "content-signature"
  | "extension-and-content"
  | "extension-only";

/** Describe the evidence behind a confirmed BR classification. */
export const businessRulesClassificationBasis = (
  format: BusinessRulesFormat,
): BusinessRulesClassificationBasis => {
  if (format === "br-compiled" || format === "br-status")
    return "content-signature";
  if (format === "br-screen") return "extension-only";
  return "extension-and-content";
};
