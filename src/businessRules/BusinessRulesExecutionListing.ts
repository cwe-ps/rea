import { err, ok, type Result } from "../domain/result.js";
import type {
  BusinessRulesFormatFailure,
  BusinessRulesHeader,
  BusinessRulesSymbolRecord,
} from "./BusinessRulesDecoder.js";
import { decompileExecutionLine } from "./BusinessRulesExecutionCode.js";
import {
  ExecutionDecodeError,
  formatNumber,
  formatString,
  hexUpper,
  type ExecutionProgram,
} from "./BusinessRulesExecutionModel.js";
import {
  applyOutputCase,
  renderEmbeddedRecord,
  renderExecutionItems,
  type RenderedExecutionLine,
} from "./BusinessRulesExecutionText.js";

/** One line reconstructed from the execution stream. */
export interface BusinessRulesExecutionLine {
  readonly number: number;
  /** Rendered line text, re-indented by block depth. */
  readonly text: string;
  /** Absolute offset of the line's code, or of its embedded DIM/DATA record. */
  readonly offset: number;
  /** True when the text comes from a DIM/DATA source record kept in the execution section. */
  readonly embedded: boolean;
  /** Uppercase statement texts before case conversion, for reference derivation. */
  readonly statements: readonly string[];
  /** Explicit unknown markers left in this line (`<?...>` or `<undecodable: ...>`). */
  readonly unknowns: readonly string[];
}

const failure = (
  kind: BusinessRulesFormatFailure["kind"],
  message: string,
): Result<never, BusinessRulesFormatFailure> =>
  err({ _tag: "BusinessRulesFormatFailure", kind, message });

interface Slot {
  readonly number: number;
  readonly code: number;
  readonly link: number;
}

const readSlots = (data: Uint8Array, header: BusinessRulesHeader): Slot[] => {
  const bytes = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from({ length: header.lineSlots }, (_, index) => {
    const slot = header.tableStart + 14 * index;
    return {
      number: bytes.getUint32(slot) & 0xffffff,
      code: bytes.getUint32(slot + 4),
      link: bytes.getUint16(slot + 12),
    };
  });
};

const ASCII_DIGIT = (value: number): boolean => value >= 0x30 && value <= 0x39;

/** Operand and jump resolution from the symbol table and line-table positions. */
const executionProgram = (
  header: BusinessRulesHeader,
  symbols: readonly BusinessRulesSymbolRecord[],
  slots: readonly Slot[],
): ExecutionProgram => {
  const byIndex = new Map(symbols.map((symbol) => [symbol.index, symbol]));
  const lengths = new Map<string, number>();
  const formSpecs = new Map<string, Uint8Array>();
  for (const symbol of symbols) {
    const type = symbol.flags >> 8;
    if (type === 0x60 && symbol.stringValue !== null) {
      if (symbol.stringValue.slice(0, 64).includes("\x00^@"))
        formSpecs.set(
          formatString(symbol.stringValue),
          Uint8Array.from(symbol.stringValue, (character) =>
            character.charCodeAt(0),
          ),
        );
    } else if (
      type !== 0x20 &&
      !symbol.name.startsWith("MAT ") &&
      (type & 3) === 0 &&
      (symbol.flags & 3) === 0
    )
      lengths.set(symbol.name, symbol.declaredWidth);
  }
  const sym = (value: number, mat = true): string => {
    if (value < 0x100) return `<?BI${hexUpper(value, 2)}>`;
    const index = value - 0x100;
    if (index >= header.symbolSlots) return `<?S${hexUpper(value)}>`;
    const symbol = byIndex.get(index);
    if (symbol === undefined) return "";
    const type = symbol.flags >> 8;
    if (type === 0x20 && symbol.numericBits !== null)
      return formatNumber(
        new DataView(
          symbol.numericBits.buffer,
          symbol.numericBits.byteOffset,
          8,
        ).getFloat64(0),
      );
    if (type === 0x60 && symbol.stringValue !== null)
      return formatString(symbol.stringValue);
    return !mat && symbol.name.startsWith("MAT ")
      ? symbol.name.slice(4)
      : symbol.name;
  };
  return {
    sym,
    rawString: (literal) => formSpecs.get(literal),
    symbolLength: (name) => lengths.get(name),
    lineRef: (position) => {
      const slot = slots[position];
      if (slot !== undefined) return String(slot.number);
      if (position >= 0xff00) return `<?REL${String(position - 0x10000)}>`;
      return `<?L${hexUpper(position)}>`;
    },
  };
};

/** Active slots in program order, following the line-table chain. */
const activeSlots = (
  header: BusinessRulesHeader,
  slots: readonly Slot[],
): Result<readonly Slot[], BusinessRulesFormatFailure> => {
  const active: Slot[] = [];
  const visited = new Set<number>();
  for (let index = header.firstLine; index !== 0xfffe;) {
    const slot = slots[index];
    if (slot === undefined || visited.has(index))
      return failure("malformed", "Invalid line-table chain.");
    visited.add(index);
    if (slot.number > 99_999)
      return failure(
        "malformed",
        `Line-table slot ${String(index)} has an out-of-range line number.`,
      );
    active.push(slot);
    index = slot.link;
  }
  return ok(active);
};

const UNKNOWN_MARKER = /<\?[^<>]*>/gu;

/** `<?...>` markers outside string literals. */
const unknownMarkers = (value: string): string[] => {
  const markers: string[] = [];
  let outside = "";
  let quote: string | null = null;
  for (const character of value) {
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      outside += "\n";
      continue;
    }
    outside += character;
  }
  for (const match of outside.matchAll(UNKNOWN_MARKER)) markers.push(match[0]);
  return markers;
};

const BLOCK_CLOSERS = ["END IF", "NEXT", "LOOP", "FNEND", "ELSE"];

const opensBlock = (upper: string): boolean =>
  (upper.startsWith("IF ") && upper.endsWith(" THEN")) ||
  upper.startsWith("FOR ") ||
  upper.startsWith("DO") ||
  upper === "ELSE" ||
  (upper.startsWith("ELSE IF") && upper.endsWith("THEN")) ||
  (upper.startsWith("DEF ") && !(upper.split(")").at(-1) ?? "").includes("="));

const hexBytes = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

/** True when DIM/DATA code (`00 4b 40` / `00 4c 40`) is followed by its source record. */
const embeddedRecord = (
  data: Uint8Array,
  code: Uint8Array,
  record: number,
): boolean => {
  const digits = data.subarray(record + 3, record + 8);
  return (
    code.length === 3 &&
    code[0] === 0 &&
    (code[1] === 0x4b || code[1] === 0x4c) &&
    code[2] === 0x40 &&
    digits.length > 0 &&
    digits.every(ASCII_DIGIT)
  );
};

/** Render a DIM/DATA line from its embedded source record. */
const embeddedLine = (
  data: Uint8Array,
  number: number,
  record: number,
): BusinessRulesExecutionLine => {
  const recordSize = ((data[record] ?? 0) << 8) | (data[record + 1] ?? 0);
  const body = data.subarray(record + 8, record + recordSize);
  const line = { number, offset: record + 2, embedded: true, statements: [] };
  try {
    const text = renderEmbeddedRecord(body);
    return { ...line, text, unknowns: unknownMarkers(text) };
  } catch (cause: unknown) {
    if (!(cause instanceof ExecutionDecodeError)) throw cause;
    const marker = `<undecodable: ${cause.kind}>`;
    return {
      ...line,
      text: `! ${marker} ${hexBytes(body)}`,
      unknowns: [marker],
    };
  }
};

/** Decompiled statements, or the explicit undecodable marker and raw bytes. */
const decompiledLine = (
  program: ExecutionProgram,
  code: Uint8Array,
): RenderedExecutionLine & { readonly failed: string | null } => {
  try {
    return {
      ...renderExecutionItems(decompileExecutionLine(program, code)),
      failed: null,
    };
  } catch (cause: unknown) {
    if (!(cause instanceof ExecutionDecodeError)) throw cause;
    const failed = `<undecodable: ${cause.kind}>`;
    return { text: `! ${failed} ${hexBytes(code)}`, statements: [], failed };
  }
};

/** Block depth tracking: closers outdent their own line, openers indent the next. */
class BlockIndenter {
  private depth = 0;

  indent(text: string): string {
    const upper = text.toUpperCase();
    if (this.depth > 0 && BLOCK_CLOSERS.some((word) => upper.startsWith(word)))
      this.depth -= 1;
    const indent = "  ".repeat(this.depth);
    if (opensBlock(upper)) this.depth += 1;
    return indent;
  }
}

/**
 * Reconstruct program lines from the execution stream, line table and symbol
 * table, in line-table chain order. DIM/DATA lines are rendered from the
 * source records the compiler embeds after their code. Lines whose code cannot
 * be decompiled are kept as `! <undecodable: kind> hex` with an unknown marker.
 */
export const decodeBusinessRulesExecution = (
  data: Uint8Array,
  header: BusinessRulesHeader,
  symbols: readonly BusinessRulesSymbolRecord[],
): Result<
  readonly BusinessRulesExecutionLine[],
  BusinessRulesFormatFailure
> => {
  if (!header.modern)
    return failure(
      "unsupported",
      "Execution-stream decoding supports only the modern (51-byte header) layout.",
    );
  const slots = readSlots(data, header);
  const active = activeSlots(header, slots);
  if (!active.ok) return active;
  const program = executionProgram(header, symbols, slots);
  const lines: BusinessRulesExecutionLine[] = [];
  const blocks = new BlockIndenter();
  for (const { number, code: pointer } of active.value) {
    const start = header.codeStart + pointer;
    const size = data[start - 1];
    if (pointer === 0 || size === undefined || start + size > header.tableStart)
      return failure(
        "malformed",
        `Line ${String(number)} code pointer lies outside the execution section.`,
      );
    const code = data.subarray(start, start + size);
    if (embeddedRecord(data, code, start + size)) {
      lines.push(embeddedLine(data, number, start + size));
      continue;
    }
    const decoded = decompiledLine(program, code);
    const line = { number, offset: start, embedded: false };
    if (decoded.text === "") {
      lines.push({ ...line, text: "!", statements: [], unknowns: [] });
      continue;
    }
    const text =
      blocks.indent(decoded.text) + applyOutputCase(decoded.text, true);
    lines.push({
      ...line,
      text,
      statements: decoded.statements,
      unknowns:
        decoded.failed === null ? unknownMarkers(text) : [decoded.failed],
    });
  }
  return ok(lines);
};
