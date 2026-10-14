/**
 * Invented compiled Business Rules! containers built from the documented
 * format: modern 51-byte big-endian and legacy 30-byte little-endian headers,
 * 14-byte line-table slots, saved-LIST records and modern symbol slots. No
 * vendor program bytes are embedded.
 */

const ascii = (text: string): Buffer => Buffer.from(text, "latin1");

/** Concatenate token bytes, Latin-1 text and prebuilt tokens into one record body. */
export const body = (...parts: readonly (number | string | Buffer)[]): Buffer =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === "number"
        ? Buffer.from([part])
        : typeof part === "string"
          ? ascii(part)
          : part,
    ),
  );

/** Length-prefixed text run token (groups 03..06). */
export const run = (group: 3 | 4 | 5 | 6, text: string): Buffer =>
  Buffer.concat([Buffer.from([group, text.length]), ascii(text)]);

/** Saved-LIST record with its two-byte length prefix and optional NUL terminator. */
export const record = (
  number: number,
  content: Buffer,
  littleEndian = false,
  terminated = true,
): Buffer => {
  const payload = Buffer.concat([
    Buffer.from([1]),
    ascii(String(number).padStart(5, "0")),
    content,
    Buffer.from(terminated ? [0] : []),
  ]);
  const size = Buffer.alloc(2);
  if (littleEndian) size.writeUInt16LE(payload.length + 2);
  else size.writeUInt16BE(payload.length + 2);
  return Buffer.concat([size, payload]);
};

/** One numbered program line and whether its record is embedded in execution. */
export interface FixtureLine {
  readonly number: number;
  readonly body: Buffer;
  readonly embedded?: boolean;
  readonly unterminated?: boolean;
}

/** Build a modern container whose line table chains lines in ascending order. */
export const modernProgram = (
  lines: readonly FixtureLine[],
  options: { readonly symbols?: Buffer; readonly symbolSlots?: number } = {},
): Buffer => {
  const code: Buffer[] = [];
  const listing: Buffer[] = [];
  const table: Buffer[] = [];
  let codeBytes = 0;
  let listingBytes = 0;
  const rows = [...lines].sort((left, right) => left.number - right.number);
  for (const [index, line] of rows.entries()) {
    const codeOffset = codeBytes + 1;
    let offset: number;
    if (line.embedded === true) {
      const prefix = Buffer.from([0x03, 0x00, 0x4b, 0x40]);
      offset = codeBytes + prefix.length + 2;
      const saved = record(line.number, line.body);
      code.push(prefix, saved);
      codeBytes += prefix.length + saved.length;
    } else {
      const stub = Buffer.from([0x01, 0x40]);
      code.push(stub);
      codeBytes += stub.length;
      offset = listingBytes + 2;
      const saved = record(
        line.number,
        line.body,
        false,
        line.unterminated !== true,
      );
      listing.push(saved);
      listingBytes += saved.length;
    }
    const slot = Buffer.alloc(14);
    slot.writeUInt32BE(line.number | (line.embedded === true ? 0x02000000 : 0));
    slot.writeUInt32BE(codeOffset, 4);
    slot.writeUInt32BE(offset, 8);
    slot.writeUInt16BE(index < rows.length - 1 ? index + 1 : 0xfffe, 12);
    table.push(slot);
  }
  const symbols = options.symbols ?? Buffer.alloc(0);
  const header = Buffer.alloc(51);
  const tableStart = 51 + codeBytes;
  const symbolsStart = tableStart + 14 * rows.length;
  const listingStart = symbolsStart + symbols.length;
  header.writeUInt32BE(51, 0);
  header.writeUInt32BE(codeBytes, 4);
  Buffer.from("0c260380", "hex").copy(header, 8);
  header.writeUInt16BE(0, 12);
  header.writeUInt32BE(listingStart, 14);
  header.writeUInt32BE(listingBytes, 18);
  header.writeUInt32BE(tableStart, 22);
  header.writeUInt32BE(14 * rows.length, 26);
  header.writeUInt32BE(rows.length, 30);
  header.writeUInt32BE(symbolsStart, 34);
  header.writeUInt32BE(symbols.length, 38);
  header.writeUInt32BE(options.symbolSlots ?? 0, 42);
  Buffer.from("0118000001", "hex").copy(header, 46);
  return Buffer.concat([header, ...code, ...table, symbols, ...listing]);
};

/** Remove the saved LIST and zero its declared size, as stripping does. */
export const stripListing = (program: Buffer): Buffer => {
  const listingStart = program.readUInt32BE(14);
  const stripped = Buffer.from(program.subarray(0, listingStart));
  stripped.writeUInt32BE(0, 18);
  return stripped;
};

/** Build a one-line legacy little-endian container with a given version byte. */
export const legacyProgram = (
  number: number,
  content: Buffer,
  versionByte = 0x1f,
): Buffer => {
  const saved = record(number, content, true);
  const header = Buffer.alloc(30);
  const execution = Buffer.from([0x01, 0x40]);
  header.writeUInt32LE(execution.length, 0);
  header.writeUInt32LE(saved.length, 4);
  Buffer.from([0x0a, versionByte, 0x00, 0x80]).copy(header, 8);
  header.writeUInt32LE(30, 20);
  header.writeUInt16LE(1, 26);
  const slot = Buffer.alloc(14);
  slot.writeUInt32LE(number);
  slot.writeUInt32LE(2, 4);
  slot.writeUInt32LE(1, 8);
  slot.writeUInt16LE(0xfffe, 12);
  return Buffer.concat([header, execution, slot, saved]);
};

/** Modern symbol slot: marker, name, auxiliary tag, flags, width, definition, payload. */
export const symbol = (
  name: string,
  flags: number,
  payload: Buffer = Buffer.alloc(0),
  options: { readonly tag?: number; readonly width?: number } = {},
): Buffer => {
  const fixed = Buffer.alloc(8);
  fixed.writeUInt16BE(flags, 0);
  fixed.writeUInt32BE(options.width ?? 0, 2);
  return Buffer.concat([
    Buffer.from([1, name.length]),
    ascii(name),
    Buffer.from([options.tag ?? 0]),
    fixed,
    payload,
  ]);
};

/** Big-endian u32 sequence, used for dimensions and string lengths. */
export const u32 = (...values: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(4 * values.length);
  for (const [index, value] of values.entries())
    bytes.writeUInt32BE(value, 4 * index);
  return bytes;
};

/** Big-endian IEEE-754 binary64 constant payload. */
export const float64 = (value: number): Buffer => {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(value);
  return bytes;
};

/** One stripped-program line: its compiled code and an optional embedded DIM/DATA record body. */
export interface ExecutionLine {
  readonly number: number;
  readonly code: Buffer;
  readonly record?: Buffer;
}

/**
 * Build a stripped modern container (saved-LIST size 0) from compiled line
 * code. `slots` places each line (in program order) at a line-table position,
 * so jump operands can be checked against positions rather than numbers.
 */
export const strippedProgram = (
  lines: readonly ExecutionLine[],
  options: {
    readonly symbols?: Buffer;
    readonly symbolSlots?: number;
    readonly slots?: readonly number[];
  } = {},
): Buffer => {
  const slots = options.slots ?? lines.map((_, index) => index);
  const code: Buffer[] = [];
  const table = Buffer.alloc(14 * lines.length);
  let codeBytes = 0;
  for (const [index, line] of lines.entries()) {
    const embedded =
      line.record === undefined
        ? Buffer.alloc(0)
        : record(line.number, line.record);
    const chunk = Buffer.concat([
      Buffer.from([line.code.length]),
      line.code,
      embedded,
    ]);
    const slot = 14 * (slots[index] ?? index);
    table.writeUInt32BE(line.number, slot);
    table.writeUInt32BE(codeBytes + 1, slot + 4);
    table.writeUInt16BE(slots[index + 1] ?? 0xfffe, slot + 12);
    code.push(chunk);
    codeBytes += chunk.length;
  }
  const symbols = options.symbols ?? Buffer.alloc(0);
  const header = Buffer.alloc(51);
  const tableStart = 51 + codeBytes;
  const symbolsStart = tableStart + table.length;
  header.writeUInt32BE(51, 0);
  header.writeUInt32BE(codeBytes, 4);
  Buffer.from("0c2603a0", "hex").copy(header, 8);
  header.writeUInt16BE(slots[0] ?? 0xfffe, 12);
  header.writeUInt32BE(symbolsStart + symbols.length, 14);
  header.writeUInt32BE(0, 18);
  header.writeUInt32BE(tableStart, 22);
  header.writeUInt32BE(table.length, 26);
  header.writeUInt32BE(lines.length, 30);
  header.writeUInt32BE(symbolsStart, 34);
  header.writeUInt32BE(symbols.length, 38);
  header.writeUInt32BE(options.symbolSlots ?? 0, 42);
  Buffer.from("0118000001", "hex").copy(header, 46);
  return Buffer.concat([header, ...code, table, symbols]);
};

/** Little-endian u16 operands: symbol slot `i` is `0x100 + i`, jump targets are table positions. */
export const operands = (...values: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(2 * values.length);
  for (const [index, value] of values.entries())
    bytes.writeUInt16LE(value, 2 * index);
  return bytes;
};

/** One line of a stripped legacy container; embedded lines carry a DIM/DATA source record. */
export interface LegacyStrippedLine {
  readonly number: number;
  readonly embedded?: Buffer;
}

/**
 * Build a stripped legacy little-endian container (no saved LIST): execution
 * stubs, optional embedded source records, a chained line table and an opaque
 * symbol section.
 */
export const legacyStrippedProgram = (
  lines: readonly LegacyStrippedLine[],
  symbolSection: Buffer,
): Buffer => {
  const code: Buffer[] = [];
  const table: Buffer[] = [];
  let codeBytes = 0;
  for (const [index, line] of lines.entries()) {
    const codeOffset = codeBytes;
    const stub = Buffer.from([0x01, 0x40]);
    code.push(stub);
    codeBytes += stub.length;
    let source = 0;
    if (line.embedded !== undefined) {
      const saved = record(line.number, line.embedded, true);
      source = codeBytes + 2;
      code.push(saved);
      codeBytes += saved.length;
    }
    const slot = Buffer.alloc(14);
    slot.writeUInt32LE(
      (line.number |
        (line.embedded === undefined ? 0x08000000 : 0x8a000000)) >>>
        0,
    );
    slot.writeUInt32LE(source, 4);
    slot.writeUInt32LE(codeOffset, 8);
    slot.writeUInt16LE(index < lines.length - 1 ? index + 1 : 0xfffe, 12);
    table.push(slot);
  }
  const header = Buffer.alloc(30);
  header.writeUInt32LE(codeBytes, 0);
  header.writeUInt32LE(0, 4);
  Buffer.from([0x0a, 0x25, 0x02, 0xa0, 0x01, 0x18]).copy(header, 8);
  header.writeUInt32LE(symbolSection.length, 16);
  header.writeUInt32LE(30, 20);
  header.writeUInt16LE(2, 24);
  header.writeUInt16LE(lines.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, ...code, ...table, symbolSection]);
};
