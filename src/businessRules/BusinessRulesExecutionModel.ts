import { ATOM } from "./BusinessRulesExecutionVocabulary.js";

/**
 * Structural failure while decompiling one line. The line is kept in the
 * listing as an explicit `<undecodable: kind>` marker with its raw code bytes.
 */
export class ExecutionDecodeError extends Error {
  /** Failure class reported in the line marker. */
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = "ExecutionDecodeError";
    this.kind = kind;
  }
}

/** Raise the failure that ends decompilation of the current line. */
export const fail = (kind: string, message: string): never => {
  throw new ExecutionDecodeError(kind, message);
};

/** Assignment, AND/OR term, or DEF parameter carried by a stack entry. */
export type ExprAnnotation =
  | { readonly kind: "assign"; readonly lhs: Expr; readonly rhs: Expr }
  | { readonly kind: "logic"; readonly op: "AND" | "OR" }
  | { readonly kind: "param"; readonly mode: string; readonly name: string };

/** Decompiler stack entry: rendered text (or a pending AND/OR term) and binding strength. */
export class Expr {
  constructor(
    readonly t: string | Expr,
    readonly p: number = ATOM,
    readonly asg: ExprAnnotation | null = null,
  ) {}
}

/** Rendered text of a completed expression; pending logical terms are not text. */
export const text = (expr: Expr): string =>
  typeof expr.t === "string"
    ? expr.t
    : fail("TypeError", "pending logical term used as text");

/** Text in parentheses when it binds more loosely than the context requires. */
export const par = (expr: Expr, precedence: number): string =>
  expr.p >= precedence ? text(expr) : `(${text(expr)})`;

/** `A=B=expr` chains for LET and FOR initializers. */
export const letText = (expr: Expr): string => {
  const annotation = expr.asg;
  if (annotation === null) return text(expr);
  if (annotation.kind !== "assign")
    return fail("ValueError", "stack entry is not an assignment");
  return `${text(annotation.lhs)}=${letText(annotation.rhs)}`;
};

/** Operand and line-reference resolution against one program's tables. */
export interface ExecutionProgram {
  /** Symbol slot (`0x100 + i`) or namespaced builtin id rendered as an operand. */
  readonly sym: (value: number, mat?: boolean) => string;
  /** Raw bytes of a compiled FORM specification string constant, by rendered literal. */
  readonly rawString: (literal: string) => Uint8Array | undefined;
  /** Declared string length of a scalar variable. */
  readonly symbolLength: (name: string) => number | undefined;
  /** Program line number at a line-table position. */
  readonly lineRef: (position: number) => string;
}

/** Decompiled line item: statement text or a layout marker. */
export type ExecutionItem =
  | { readonly kind: "S"; readonly text: string }
  | { readonly kind: "THEN" | "ELSE" | "SEP" }
  | { readonly kind: "DROP"; readonly mode: "ELSE" | "ELSEGOTO" };

/** Statement item. */
export const statementItem = (value: string): ExecutionItem => ({
  kind: "S",
  text: value,
});

/** Instruction token: an operand group or an op with mode, flag and operands. */
export type ExecutionToken =
  | { readonly kind: "G"; readonly ops: readonly number[] }
  | {
      readonly kind: "O";
      readonly op: number;
      readonly m: number;
      readonly x: number | null;
      readonly ops: readonly number[];
      readonly stmt: boolean;
    };

/** Instruction token that is an op. */
export type ExecutionOp = Extract<ExecutionToken, { kind: "O" }>;

/** Upper-case hexadecimal, zero-padded to a width. */
export const hexUpper = (value: number, width = 0): string =>
  value.toString(16).toUpperCase().padStart(width, "0");

/** Element at an index, or the structural failure of indexing past the end. */
export const at = <T>(values: readonly T[], index: number): T => {
  const value = values[index];
  return value === undefined
    ? fail("IndexError", `index ${String(index)} out of range`)
    : value;
};

/** Byte at an index, or the structural failure of reading past the end. */
export const byteAt = (bytes: Uint8Array, index: number): number => {
  const value = bytes[index];
  return value === undefined
    ? fail("IndexError", `byte ${String(index)} out of range`)
    : value;
};

/** Shortest round-trip decimal digits and exponent of a finite non-zero number. */
const decimalParts = (
  value: number,
): { readonly digits: string; readonly exponent: number } => {
  const [mantissa = "", exponent = "0"] = Math.abs(value)
    .toExponential()
    .split("e");
  return { digits: mantissa.replace(".", ""), exponent: Number(exponent) };
};

/** Shortest round-trip float spelling with positional/scientific switching at 1e-4 and 1e16. */
const floatRepr = (value: number): string => {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const sign = value < 0 ? "-" : "";
  const { digits, exponent } = decimalParts(value);
  if (exponent < -4 || exponent >= 16) {
    const mantissa =
      digits.length === 1 ? digits : `${digits[0] ?? ""}.${digits.slice(1)}`;
    const magnitude = String(Math.abs(exponent)).padStart(2, "0");
    return `${sign}${mantissa}e${exponent < 0 ? "-" : "+"}${magnitude}`;
  }
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
  const fraction = digits.slice(exponent + 1);
  return `${sign}${whole}.${fraction === "" ? "0" : fraction}`;
};

/** Numeric constant spelling: integers plainly, fractions without a leading zero. */
export const formatNumber = (value: number): string => {
  if (Number.isNaN(value))
    return fail("ValueError", "cannot render a NaN constant");
  if (!Number.isFinite(value))
    return fail("OverflowError", "cannot render an infinite constant");
  if (Number.isInteger(value) && Math.abs(value) < 1e15)
    return String(Math.trunc(value) + 0);
  const spelled = floatRepr(value);
  if (spelled.startsWith("0.")) return spelled.slice(1);
  if (spelled.startsWith("-0.")) return `-${spelled.slice(2)}`;
  return spelled;
};

/** Double-quoted string constant with doubled embedded quotes. */
export const formatString = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

/** ISO-8859-1 text of a byte range. */
export const latin1 = (bytes: Uint8Array): string => {
  let result = "";
  for (let start = 0; start < bytes.length; start += 0x2000)
    result += String.fromCharCode(...bytes.subarray(start, start + 0x2000));
  return result;
};
