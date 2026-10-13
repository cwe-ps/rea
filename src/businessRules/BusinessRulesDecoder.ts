import { err, ok, type Result } from "../domain/result.js";
import {
  BUSINESS_RULES_CLAUSES,
  BUSINESS_RULES_STATEMENTS,
} from "./BusinessRulesTokens.js";

/** Expected decoder refusal: unrecognized container versus damaged structure. */
export interface BusinessRulesFormatFailure {
  readonly _tag: "BusinessRulesFormatFailure";
  readonly kind: "unsupported" | "malformed";
  readonly message: string;
}

const failure = (
  kind: BusinessRulesFormatFailure["kind"],
  message: string,
): Result<never, BusinessRulesFormatFailure> =>
  err({ _tag: "BusinessRulesFormatFailure", kind, message });

const hex = (value: number): string => `0x${value.toString(16)}`;

/** Container layout read from the 51-byte modern or 30/32-byte legacy header. */
export interface BusinessRulesHeader {
  readonly modern: boolean;
  readonly headerBytes: 30 | 32 | 51;
  readonly littleEndian: boolean;
  readonly versionBytes: Uint8Array;
  readonly optionBytes: Uint8Array;
  readonly codeStart: number;
  readonly codeSize: number;
  readonly tableStart: number;
  readonly tableSize: number;
  readonly lineSlots: number;
  readonly firstLine: number;
  readonly symbolsStart: number;
  readonly symbolsSize: number;
  readonly symbolSlots: number;
  readonly listingStart: number;
  readonly listingSize: number;
  readonly oldClauses: boolean;
}

const view = (data: Uint8Array): DataView =>
  new DataView(data.buffer, data.byteOffset, data.byteLength);

/** Read and cross-check the section layout without trusting any single field. */
export const readBusinessRulesHeader = (
  data: Uint8Array,
): Result<BusinessRulesHeader, BusinessRulesFormatFailure> => {
  if (data.length < 32)
    return failure(
      "unsupported",
      "File is shorter than any recognized Business Rules! header.",
    );
  const bytes = view(data);
  const modern =
    data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 0x33;
  let header: BusinessRulesHeader;
  if (modern) {
    if (data.length < 51)
      return failure("malformed", "Truncated modern Business Rules! header.");
    const u32 = (position: number): number => bytes.getUint32(position);
    header = {
      modern,
      headerBytes: 51,
      littleEndian: false,
      versionBytes: data.subarray(8, 12),
      optionBytes: data.subarray(46, 51),
      codeStart: u32(0),
      codeSize: u32(4),
      tableStart: u32(22),
      tableSize: u32(26),
      lineSlots: u32(30),
      firstLine: bytes.getUint16(12),
      symbolsStart: u32(34),
      symbolsSize: u32(38),
      symbolSlots: u32(42),
      listingStart: u32(14),
      listingSize: u32(18),
      oldClauses: false,
    };
    if (header.codeStart + header.codeSize !== header.tableStart)
      return failure("malformed", "Inconsistent execution-section size.");
    if (header.tableSize !== 14 * header.lineSlots)
      return failure("malformed", "Inconsistent declared line-table size.");
  } else {
    const u32 = (position: number): number => bytes.getUint32(position, true);
    const base = u32(20);
    if (data[8] !== 10 || (base !== 30 && base !== 32))
      return failure(
        "unsupported",
        "Unsupported Business Rules! header variant.",
      );
    const codeSize = u32(0);
    const lineSlots = bytes.getUint16(26, true);
    const tableStart = base + codeSize;
    header = {
      modern,
      headerBytes: base,
      littleEndian: true,
      versionBytes: data.subarray(8, 12),
      optionBytes: data.subarray(12, 16),
      codeStart: base,
      codeSize,
      tableStart,
      tableSize: 14 * lineSlots,
      lineSlots,
      firstLine: bytes.getUint16(28, true),
      symbolsStart: tableStart + 14 * lineSlots,
      symbolsSize: u32(16),
      symbolSlots: bytes.getUint16(24, true),
      listingStart: data.length - u32(4),
      listingSize: u32(4),
      oldClauses: (data[9] ?? 0) <= 0x1f,
    };
  }
  if (
    !(
      header.codeStart <= header.tableStart &&
      header.tableStart <= header.symbolsStart &&
      header.symbolsStart <= header.symbolsStart + header.symbolsSize &&
      header.symbolsStart + header.symbolsSize <= header.listingStart &&
      header.listingStart <= data.length
    )
  )
    return failure("malformed", "Damaged Business Rules! section boundaries.");
  if (header.tableStart + 14 * header.lineSlots !== header.symbolsStart)
    return failure("malformed", "Inconsistent line-table size.");
  if (header.listingStart + header.listingSize !== data.length)
    return failure("malformed", "Inconsistent saved-listing size.");
  return ok(header);
};

/** One active saved-LIST record reached through the line-table chain. */
export interface BusinessRulesSourceRecord {
  readonly number: number;
  readonly body: Uint8Array;
  readonly offset: number;
  readonly embedded: boolean;
  readonly slot: number;
}

const ASCII_ZERO = 0x30;
const isAsciiDigit = (value: number | undefined): boolean =>
  value !== undefined && value >= ASCII_ZERO && value <= ASCII_ZERO + 9;

/** Follow the active line-table chain; unreachable slots are never decoded. */
export const readBusinessRulesSourceRecords = (
  data: Uint8Array,
  header: BusinessRulesHeader,
): Result<readonly BusinessRulesSourceRecord[], BusinessRulesFormatFailure> => {
  const bytes = view(data);
  const records: BusinessRulesSourceRecord[] = [];
  const visited = new Set<number>();
  const little = header.littleEndian;
  let index = header.firstLine;
  while (index !== 0xfffe) {
    if (index >= header.lineSlots || visited.has(index))
      return failure("malformed", "Invalid line-table chain.");
    visited.add(index);
    const slot = header.tableStart + 14 * index;
    const flags = bytes.getUint32(slot, little);
    const first = bytes.getUint32(slot + 4, little);
    const second = bytes.getUint32(slot + 8, little);
    const link = bytes.getUint16(slot + 12, little);
    const code = header.modern ? first : second;
    const offset = header.modern ? second : first;
    if (flags === 0 && code === 0 && offset === 0 && link === 0)
      return failure(
        "malformed",
        "Active line-table chain points to an empty slot.",
      );
    const embedded = (flags & 0x02000000) !== 0;
    const base = embedded ? header.codeStart : header.listingStart;
    const limit = embedded ? header.tableStart : data.length;
    const position = base + offset;
    if (!(base + 2 <= position && position < limit))
      return failure(
        "malformed",
        `Source pointer outside its section at ${hex(position)}.`,
      );
    const size = bytes.getUint16(position - 2, little);
    if (size < 9 || position - 2 + size > limit)
      return failure(
        "malformed",
        `Invalid source-record size at ${hex(position)}.`,
      );
    const record = data.subarray(position, position - 2 + size);
    const digits = record.subarray(1, 6);
    if (!digits.every((value) => isAsciiDigit(value)))
      return failure(
        "malformed",
        `Invalid source-record line number at ${hex(position)}.`,
      );
    const number = digits.reduce(
      (total, value) => total * 10 + value - ASCII_ZERO,
      0,
    );
    if (number !== (flags & 0x00ffffff))
      return failure(
        "malformed",
        `Line-table/source number disagreement at ${hex(position)}.`,
      );
    records.push({
      number,
      body: record.subarray(6),
      offset: position,
      embedded,
      slot: index,
    });
    index = link;
  }
  return ok(records);
};

/** Saved-LIST token: keyword, indentation, text run, or literal character. */
export type BusinessRulesToken =
  | { readonly group: 1; readonly code: number }
  | { readonly group: 2; readonly code: number }
  | { readonly group: 7; readonly spaces: number }
  | { readonly group: 3 | 4 | 5 | 6; readonly text: string }
  | { readonly group: 0; readonly text: string };

/** ISO-8859-1 maps each byte to the code point of the same value. */
const latin1Text = (bytes: Uint8Array): string => {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x2000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x2000));
  return text;
};

const isTextGroup = (group: number): group is 3 | 4 | 5 | 6 =>
  group >= 3 && group <= 6;

/** Tokenize one record body; a NUL ends the record even inside a nominal run. */
export const tokenizeBusinessRulesRecord = (
  body: Uint8Array,
  oldClauses: boolean,
): Result<readonly BusinessRulesToken[], BusinessRulesFormatFailure> => {
  const tokens: BusinessRulesToken[] = [];
  let index = 0;
  while (index < body.length) {
    const group = body[index] ?? 0;
    index += 1;
    if (group === 0) return ok(tokens);
    if (group === 1 || group === 2 || group === 7) {
      const value = body[index];
      if (value === undefined)
        return failure("malformed", "Truncated keyword/indentation token.");
      index += 1;
      if (group === 7) tokens.push({ group: 7, spaces: value });
      else {
        const historical =
          group === 2 &&
          oldClauses &&
          value >= 0x20 &&
          value < 0x40 &&
          BUSINESS_RULES_CLAUSES.has(value + 0x40);
        tokens.push(
          group === 1
            ? { group: 1, code: value }
            : { group: 2, code: historical ? value + 0x40 : value },
        );
      }
    } else if (isTextGroup(group)) {
      const size = body[index];
      if (size === undefined)
        return failure("malformed", "Truncated text token.");
      index += 1;
      const run = body.subarray(index, index + size);
      const terminator = run.indexOf(0);
      if (terminator >= 0) {
        tokens.push({ group, text: latin1Text(run.subarray(0, terminator)) });
        return ok(tokens);
      }
      if (index + size > body.length)
        return failure("malformed", "Text token exceeds its source record.");
      tokens.push({ group, text: latin1Text(run) });
      index += size;
    } else if (group >= 32 || group === 9 || group === 10 || group === 13)
      tokens.push({ group: 0, text: String.fromCharCode(group) });
    else
      return failure(
        "unsupported",
        `Unknown source token group 0x${group.toString(16).padStart(2, "0")}.`,
      );
  }
  return failure("malformed", "Unterminated source record.");
};

const placeholder = (group: 1 | 2, code: number): string =>
  `[[0${String(group)}:${code.toString(16).padStart(2, "0")}]]`;

/** Keyword spelling, or a visible placeholder for an unresolved code. */
export const businessRulesKeyword = (group: 1 | 2, code: number): string =>
  (group === 1 ? BUSINESS_RULES_STATEMENTS : BUSINESS_RULES_CLAUSES).get(
    code,
  ) ?? placeholder(group, code);

/** Latin-1 whitespace removed around a rendered record. */
const WHITESPACE = new Set([
  "\t",
  "\n",
  "\v",
  "\f",
  "\r",
  "\x1c",
  "\x1d",
  "\x1e",
  "\x1f",
  " ",
  "\x85",
  "\xa0",
]);

const trimWhitespace = (text: string): string => {
  let start = 0;
  let end = text.length;
  while (start < end && WHITESPACE.has(text.charAt(start))) start += 1;
  while (end > start && WHITESPACE.has(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
};

/** Render tokens as LIST text, spacing keywords as the saved listing implies. */
export const renderBusinessRulesTokens = (
  tokens: readonly BusinessRulesToken[],
): string => {
  let output = "";
  for (const [index, token] of tokens.entries()) {
    if (token.group === 1 || token.group === 2) {
      const word = businessRulesKeyword(token.group, token.code);
      if (word === "") continue;
      if (output !== "" && !/[ :,]$/u.test(output)) output += " ";
      output += word;
      const following = tokens[index + 1];
      if (
        !word.endsWith("=") &&
        following !== undefined &&
        (token.group === 1 || (following.group !== 0 && following.group !== 7))
      )
        output += " ";
    } else if (token.group === 7) output += " ".repeat(token.spaces);
    else output += token.text;
  }
  return trimWhitespace(output);
};

/** Classified symbol slot from the modern symbol section. */
export interface BusinessRulesSymbolRecord {
  readonly index: number;
  readonly offset: number;
  readonly name: string;
  readonly nameTag: number;
  readonly flags: number;
  readonly declaredWidth: number;
  readonly definitionSlot: number;
  readonly dimensions: readonly number[] | null;
  readonly stringValue: string | null;
  readonly numericBits: Uint8Array | null;
}

/** Read modern symbol slots, consuming exactly the declared section. */
export const readBusinessRulesSymbols = (
  data: Uint8Array,
  header: BusinessRulesHeader,
): Result<readonly BusinessRulesSymbolRecord[], BusinessRulesFormatFailure> => {
  if (!header.modern)
    return failure(
      "unsupported",
      "Legacy symbol payloads are not decoded by this profile.",
    );
  const bytes = view(data);
  const end = header.symbolsStart + header.symbolsSize;
  const symbols: BusinessRulesSymbolRecord[] = [];
  let position = header.symbolsStart;
  for (let index = 0; index < header.symbolSlots; index += 1) {
    const start = position;
    if (position >= end)
      return failure(
        "malformed",
        "Symbol table ended before its declared slot count.",
      );
    if (data[position] === 0) {
      position += 1;
      continue;
    }
    if (data[position] !== 1 || position + 2 > end)
      return failure("malformed", `Unknown symbol marker at ${hex(position)}.`);
    const nameSize = data[position + 1] ?? 0;
    if (position + nameSize + 11 > end)
      return failure("malformed", `Invalid symbol name at ${hex(position)}.`);
    const name = latin1Text(
      data.subarray(position + 2, position + 2 + nameSize),
    );
    const nameTag = data[position + nameSize + 2] ?? 0;
    position += nameSize + 3;
    const flags = bytes.getUint16(position);
    const declaredWidth = bytes.getUint32(position + 2);
    const definitionSlot = bytes.getUint16(position + 6);
    position += 8;
    let dimensions: number[] | null = null;
    let stringValue: string | null = null;
    let numericBits: Uint8Array | null = null;
    if ((flags & 0x2000) !== 0) {
      if ((flags & 0x4000) !== 0) {
        if (position + 4 > end)
          return failure("malformed", "Truncated string-literal length.");
        const size = bytes.getUint32(position);
        position += 4;
        if (position + size > end)
          return failure(
            "malformed",
            "String literal exceeds the symbol section.",
          );
        stringValue = latin1Text(data.subarray(position, position + size));
        position += size;
      } else {
        if (position + 8 > end)
          return failure("malformed", "Truncated numeric literal.");
        numericBits = data.subarray(position, position + 8);
        position += 8;
      }
    } else if ((flags & 3) !== 0) {
      const rank = flags & 3;
      if (position + 4 * rank > end)
        return failure("malformed", "Truncated array metadata.");
      dimensions = Array.from({ length: rank }, (_, dimension) =>
        bytes.getUint32(position + 4 * dimension),
      );
      position += 4 * rank;
    }
    symbols.push({
      index,
      offset: start,
      name,
      nameTag,
      flags,
      declaredWidth,
      definitionSlot,
      dimensions,
      stringValue,
      numericBits,
    });
  }
  if (position !== end)
    return failure("malformed", "Unconsumed bytes in the symbol section.");
  return ok(symbols);
};
