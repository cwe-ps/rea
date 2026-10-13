import { byteAt, formatString, latin1 } from "./BusinessRulesExecutionModel.js";
import {
  EXEC_FORM_ITEMS,
  EXEC_FORM_STRING_ITEMS,
} from "./BusinessRulesExecutionVocabulary.js";

const FORM_PREFIX = [0x00, 0x5e, 0x40] as const;

const hasFormPrefix = (bytes: Uint8Array, offset = 0): boolean =>
  FORM_PREFIX.every((value, index) => bytes[offset + index] === value);

/** True when a code sequence or string constant starts with the compiled FORM marker. */
export const isCompiledForm = (bytes: Uint8Array): boolean =>
  hasFormPrefix(bytes);

/** Cursor over a compiled FORM specification. */
class FormReader {
  index: number;
  private variable = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly variables: readonly string[],
  ) {
    this.index = hasFormPrefix(bytes) ? 3 : 1 + 2 * byteAt(bytes, 0) + 3;
  }

  get done(): boolean {
    return this.index >= this.bytes.length;
  }

  byte(): number {
    const value = byteAt(this.bytes, this.index);
    this.index += 1;
    return value;
  }

  word(): number {
    return this.byte() | (this.byte() << 8);
  }

  text(size: number): string {
    const value = latin1(this.bytes.subarray(this.index, this.index + size));
    this.index += size;
    return value;
  }

  /** Next statement operand supplying a computed position, length or repeat. */
  nextVariable(): string {
    this.variable += 1;
    return this.variables[this.variable - 1] ?? "?V";
  }

  /** Repeat count by mode: operand, absent, byte, or word. */
  count(mode: number): string | number | null {
    if (mode === 0) return this.nextVariable();
    if (mode === 2) return this.byte();
    if (mode === 3) return this.word();
    return null;
  }
}

const positional = (reader: FormReader, type: number, mode: number): string => {
  const value =
    mode === 0
      ? reader.nextVariable()
      : mode === 1
        ? 1
        : mode === 2
          ? reader.byte()
          : reader.word();
  return `${EXEC_FORM_ITEMS.get(type) ?? ""} ${String(value)}`;
};

const sized = (reader: FormReader, type: number, prefix: string): string => {
  const name = EXEC_FORM_ITEMS.get(type) ?? `F${String(type)}`;
  if (type === 24) return prefix + name;
  const size = reader.word();
  if (size === 0xffff) return `${prefix}${name} ${reader.nextVariable()}`;
  if (EXEC_FORM_STRING_ITEMS.has(type))
    return `${prefix}${name} ${size === 0 ? "" : String(size)}`;
  const decimals = size >> 8;
  return `${prefix}${name} ${String(size & 0xff)}${decimals === 0 ? "" : `.${String(decimals)}`}`;
};

const formItem = (reader: FormReader, code: number): string => {
  const type = code & 0x3f;
  const mode = code >> 6;
  if (type === 1 || type === 2 || type === 3)
    return positional(reader, type, mode);
  const count = reader.count(mode);
  const prefix =
    count === null || count === 0 || count === "" ? "" : `${String(count)}*`;
  if (type === 4) return `${prefix}(`;
  if (type === 5) return ")";
  if (type === 6 || type === 7) {
    const size = reader.byte();
    if (type === 6) reader.index += 1;
    const value = reader.text(size);
    return prefix + (type === 6 ? `PIC(${value})` : formatString(value));
  }
  return sized(reader, type, prefix);
};

/**
 * Decode a compiled FORM specification. An optional prefix lists symbol
 * operands for computed POS/X/SKIP values, lengths (0xffff) and repeat
 * counts (mode 0); they are taken in order from `variables`.
 */
export const decodeForm = (
  bytes: Uint8Array,
  variables: readonly string[] = [],
): string => {
  const reader = new FormReader(bytes, variables);
  const items: string[] = [];
  while (!reader.done) {
    const code = reader.byte();
    if (code === 0) break;
    items.push(formItem(reader, code));
  }
  let output = "";
  for (const item of items)
    if (item === ")") output += ")";
    else {
      if (output !== "" && !output.endsWith("(")) output += ",";
      output += item;
    }
  return output;
};
