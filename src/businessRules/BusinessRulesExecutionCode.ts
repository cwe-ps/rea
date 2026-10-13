import { decodeForm, isCompiledForm } from "./BusinessRulesExecutionForm.js";
import {
  Expr,
  fail,
  hexUpper,
  letText,
  par,
  statementItem,
  text,
  type ExecutionItem,
  type ExecutionOp,
  type ExecutionProgram,
  type ExecutionToken,
} from "./BusinessRulesExecutionModel.js";
import {
  decodeStatement,
  type ExecutionStack,
} from "./BusinessRulesExecutionStatements.js";
import {
  ATOM,
  builtinKey,
  EXEC_BINARY,
  EXEC_BUILTINS,
  EXEC_PRECEDENCE,
  SUBSTRING_BUILTIN,
} from "./BusinessRulesExecutionVocabulary.js";

const u16 = (code: Uint8Array, index: number): number =>
  (code[index] ?? 0) | ((code[index + 1] ?? 0) << 8);

const operands = (code: Uint8Array, start: number, count: number): number[] =>
  Array.from({ length: count }, (_, index) => u16(code, start + 2 * index));

/**
 * Split one line's code into operand groups and ops. A group (count byte
 * below 0x40, then u16le operands) starts each statement. Op bytes carry a
 * six-bit opcode and a two-bit mode: none, statement end, one operand, or a
 * counted operand list. Bytes 0x20-0x27 are call-format ops with a flag byte
 * (mode and argument count), except inside a statement's clause list.
 */
export const tokenizeExecution = (code: Uint8Array): ExecutionToken[] => {
  const tokens: ExecutionToken[] = [];
  let index = 0;
  let group = true;
  let statement = false;
  let clause = false;
  const size = code.length;
  while (index < size) {
    const byte = code[index] ?? 0;
    if (group && byte < 0x40) {
      index += 1;
      if (index + 2 * byte > size) fail("ParseError", "group overrun");
      tokens.push({ kind: "G", ops: operands(code, index, byte) });
      index += 2 * byte;
      group = false;
      statement = byte === 0;
      continue;
    }
    index += 1;
    let op = byte & 0x3f;
    let m = byte >> 6;
    let x: number | null = null;
    if (byte >= 0x20 && byte <= 0x27 && !(clause && !statement)) {
      if (index >= size) fail("ParseError", "flag overrun");
      const flag = code[index] ?? 0;
      index += 1;
      op = byte;
      m = flag >> 6;
      x = flag & 0x3f;
    }
    let ops: number[] = [];
    if (m === 2) {
      if (index + 2 > size) fail("ParseError", "operand overrun");
      ops = [u16(code, index)];
      index += 2;
    } else if (m === 3) {
      if (index >= size) fail("ParseError", "count overrun");
      const count = code[index] ?? 0;
      index += 1;
      if (index + 2 * count > size) fail("ParseError", "operands overrun");
      ops = operands(code, index, count);
      index += 2 * count;
    }
    tokens.push({ kind: "O", op, m, x, ops, stmt: statement });
    if (statement && !(op === 0 && m === 0)) clause = true;
    if (m === 1) clause = false;
    statement = op === 0 && m === 0;
    group = m === 1;
  }
  return tokens;
};

/** Per-line decompilation state. */
class LineDecoder implements ExecutionStack {
  readonly entries: Expr[] = [];
  readonly items: ExecutionItem[] = [];
  private lastParamMode = "val";
  private readonly defContext: boolean;

  constructor(
    private readonly program: ExecutionProgram,
    readonly tokens: readonly ExecutionToken[],
  ) {
    this.defContext = tokens.some(
      (token) =>
        token.kind === "O" &&
        token.op === 0x26 &&
        (token.x === null || token.x === 0x2f),
    );
  }

  readonly pop = (): Expr => this.entries.pop() ?? new Expr("<?E>");

  readonly popMany = (count: number): Expr[] =>
    Array.from({ length: count }, () => this.pop()).reverse();

  push(value: string | Expr): void {
    this.entries.push(typeof value === "string" ? new Expr(value) : value);
  }

  pushOperands(values: readonly number[], mat = true): void {
    for (const value of values) this.push(this.program.sym(value, mat));
  }

  /** Call-format op: function call, array element, slice or declaration. */
  call(token: ExecutionOp, count: number): void {
    const { op, ops } = token;
    const target = ops[0];
    if (op === 0x20 || op === 0x21 || op === 0x22) {
      let args: Expr[] = [];
      if (count === 0) this.pop();
      else args = this.popMany(count);
      const value = target ?? 0;
      const name =
        value < 0x100
          ? (EXEC_BUILTINS.get(builtinKey(op, value)) ??
            `<?B${hexUpper(op)}_${hexUpper(value, 2)}>`)
          : this.program.sym(value);
      const [source, low, high] = args;
      if (
        name === SUBSTRING_BUILTIN &&
        args.length === 3 &&
        source &&
        low &&
        high
      )
        this.push(`${par(source, ATOM)}(${text(low)}:${text(high)})`);
      else
        this.push(
          name +
            (count === 0 ? "" : `(${args.map((arg) => text(arg)).join(",")})`),
        );
      this.pushOperands(ops.slice(1));
    } else if (op === 0x23) {
      const args = this.popMany(count);
      const name =
        target === undefined ? "<?A>" : this.program.sym(target, false);
      this.push(`${name}(${args.map((arg) => text(arg)).join(",")})`);
      this.pushOperands(ops.slice(1));
    } else if (op === 0x25) {
      const array = text(this.pop());
      this.push(
        `${array.startsWith("MAT ") ? array.slice(4) : array}(${String(count)})`,
      );
      this.pushOperands(ops);
    } else if (op === 0x27) {
      this.push(
        `<LIBFN ${target === undefined ? "?" : this.program.sym(target)}>`,
      );
      this.pushOperands(ops.slice(1));
    } else if ((op === 0x26 && count !== 0x2f) || op === 0x24) {
      const args = this.popMany(count);
      const name = target === undefined ? "<?A>" : this.program.sym(target);
      const joiner = op === 0x26 ? ":" : ",";
      this.push(`${name}(${args.map((arg) => text(arg)).join(joiner)})`);
      this.pushOperands(ops.slice(1));
    } else {
      this.push(`<?OP${hexUpper(op, 2)}:${String(count)}>`);
      this.pushOperands(ops);
    }
  }

  /** Close an AND/OR chain opened by 0x3a. */
  logicalGroup(): void {
    const last = this.pop();
    const terms: { term: Expr; op: string }[] = [];
    for (
      let top = this.entries.at(-1);
      top?.p === -2;
      top = this.entries.at(-1)
    ) {
      this.entries.pop();
      if (typeof top.t === "string" || top.asg?.kind !== "logic")
        return fail("TypeError", "malformed logical term");
      terms.unshift({ term: top.t, op: top.asg.op });
    }
    if (this.entries.at(-1)?.p === -1) this.entries.pop();
    let output = par(last, 3);
    for (const { term, op } of terms.toReversed())
      output = `${par(term, 3)} ${op} ${output}`;
    this.push(new Expr(output, 2));
  }

  /** DEF parameter list markers (optional `;`, by-reference, by-value). */
  parameters(token: ExecutionOp): void {
    let mode: string;
    if (token.op === 0x37) {
      this.push(new Expr(";", -4, { kind: "param", mode: ";", name: "" }));
      mode = this.lastParamMode;
    } else {
      mode = token.op === 0x38 ? "ref" : "val";
      this.lastParamMode = mode;
    }
    for (const value of token.ops)
      this.push(
        new Expr("", -4, {
          kind: "param",
          mode,
          name: this.program.sym(value),
        }),
      );
  }

  /** Assignment and operator ops. Returns false when operands must not be pushed. */
  expression(token: ExecutionOp): boolean {
    const { op, m, stmt } = token;
    if (op === 0x0e) {
      const value = this.pop();
      const high = this.pop();
      const low = this.pop();
      const array = this.pop();
      const target = new Expr(
        `${par(array, ATOM)}(${text(low)}:${text(high)})`,
      );
      this.push(
        new Expr(`${text(target)}:=${par(value, 1)}`, 1, {
          kind: "assign",
          lhs: target,
          rhs: value,
        }),
      );
    } else if (op === 0x0d) {
      const value = this.pop();
      const target = this.pop();
      this.push(
        new Expr(`${text(target)}:=${par(value, 1)}`, 1, {
          kind: "assign",
          lhs: target,
          rhs: value,
        }),
      );
    } else if (EXEC_BINARY.has(op)) {
      const right = this.pop();
      const left = this.pop();
      const operator = EXEC_BINARY.get(op) ?? "";
      const precedence = EXEC_PRECEDENCE.get(operator) ?? 0;
      const associative = ["&", "+", "*"].includes(operator);
      this.push(
        new Expr(
          par(left, precedence) +
            operator +
            par(right, associative ? precedence : precedence + 1),
          precedence,
        ),
      );
    } else if (op === 0x30) this.push(new Expr(`NOT ${par(this.pop(), 3)}`, 3));
    else if (op === 0x31) this.push(new Expr(`~${par(this.pop(), 8)}`, 8));
    else if (op === 0x32) this.push(new Expr(`-${par(this.pop(), 8)}`, 8));
    else if (op === 0x33 || op === 0x34 || op === 0x35)
      this.push(
        `${op === 0x33 ? "ABS" : op === 0x34 ? "INT" : "SGN"}(${text(this.pop())})`,
      );
    else if (op === 0x3a) {
      const operand = this.pop();
      this.push(new Expr("<LOG>", -1));
      this.push(operand);
    } else if (op === 0x3d || op === 0x3e)
      this.push(
        new Expr(this.pop(), -2, {
          kind: "logic",
          op: op === 0x3d ? "AND" : "OR",
        }),
      );
    else if (op === 0x3b) this.logicalGroup();
    else if (
      (op === 0x37 || op === 0x38 || op === 0x39) &&
      !stmt &&
      m !== 1 &&
      this.defContext
    ) {
      this.parameters(token);
      return false;
    } else if (op === 0x3c) {
      this.push(new Expr("<IOSEP>", -3));
      this.pushOperands(token.ops);
      return false;
    } else this.push(`<?X${hexUpper(op, 2)}/${String(m)}>`);
    return true;
  }
}

const sameBytes = (code: Uint8Array, ...prefix: number[]): boolean =>
  prefix.every((value, index) => code[index] === value);

/** Collect a statement's ops up to and including the first statement-end op. */
const statementOps = (
  tokens: readonly ExecutionToken[],
  start: number,
): { readonly ops: ExecutionOp[]; readonly next: number } => {
  const ops: ExecutionOp[] = [];
  let index = start;
  for (let token = tokens[index]; token?.kind === "O"; token = tokens[index]) {
    ops.push(token);
    index += 1;
    if (token.m === 1) break;
  }
  return { ops, next: index };
};

/**
 * Decompile one line's code into statement items and layout markers.
 * Structural failures raise {@link ExecutionDecodeError}.
 */
export const decompileExecutionLine = (
  program: ExecutionProgram,
  code: Uint8Array,
): ExecutionItem[] => {
  if (isCompiledForm(code) && code.length > 4)
    return [statementItem(`FORM ${decodeForm(code)}`)];
  if (sameBytes(code, 0x00, 0x47, 0x40) && code.length >= 8)
    return [
      statementItem(
        code[7] === 0 ? `OPTION BASE ${String(code[3] ?? 0)}` : "OPTION RETAIN",
      ),
    ];
  const tokens = tokenizeExecution(code);
  const line = new LineDecoder(program, tokens);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    index += 1;
    if (token === undefined) break;
    if (token.kind === "G") {
      line.pushOperands(token.ops);
      continue;
    }
    let { op, m } = token;
    if (token.stmt && !(op === 0 && (m === 0 || m === 1))) {
      index -= 1;
      op = 0;
      m = 0;
    }
    if (op === 0 && m === 0) {
      const statement = statementOps(tokens, index);
      index = statement.next;
      if (statement.ops.length > 0)
        line.items.push(...decodeStatement(program, statement.ops, line));
      line.entries.length = 0;
    } else if (op === 0 && m === 1) {
      line.items.push({ kind: "SEP" });
      line.entries.length = 0;
    } else if (op === 0x3f && m === 1) line.items.push({ kind: "ELSE" });
    else if (op === 0x01 && m === 1) {
      line.items.push(statementItem(`LET ${letText(line.pop())}`));
      line.entries.length = 0;
    } else if (token.x !== null) line.call(token, token.x);
    else if (line.expression(token)) line.pushOperands(token.ops);
  }
  return line.items;
};
