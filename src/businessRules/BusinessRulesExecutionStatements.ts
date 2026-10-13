import { decodeForm } from "./BusinessRulesExecutionForm.js";
import { ioStatement } from "./BusinessRulesExecutionIo.js";
import {
  at,
  Expr,
  hexUpper,
  letText,
  statementItem,
  text,
  type ExecutionItem,
  type ExecutionOp,
  type ExecutionProgram,
} from "./BusinessRulesExecutionModel.js";
import {
  ATOM,
  EXEC_BINARY,
  EXEC_CLAUSES,
  EXEC_ERROR_CLAUSES,
  EXEC_IO_STATEMENTS,
  EXEC_ON_CONDITIONS,
  EXEC_STATEMENTS,
} from "./BusinessRulesExecutionVocabulary.js";

/** Operand stack shared by a line's expressions and its statements. */
export interface ExecutionStack {
  readonly entries: Expr[];
  /** Pop one entry; an empty stack yields an explicit `<?E>` operand. */
  readonly pop: () => Expr;
  /** Pop `count` entries in push order. */
  readonly popMany: (count: number) => Expr[];
}

/** Jump target, or the IGNORE/SYSTEM pseudo-targets of error clauses. */
export const errorTarget = (
  program: ExecutionProgram,
  value: number,
): string =>
  value === 0xfffd
    ? "IGNORE"
    : value === 0xfffe
      ? "SYSTEM"
      : program.lineRef(value);

/** Trailing error clauses (`IOERR 900`, `EOF IGNORE`) of a statement. */
export const errorClauses = (
  program: ExecutionProgram,
  rest: readonly ExecutionOp[],
): string => {
  let output = "";
  for (const clause of rest)
    if (EXEC_ERROR_CLAUSES.has(clause.op) && clause.m === 2)
      output += ` ${EXEC_CLAUSES.get(clause.op) ?? "?"} ${errorTarget(program, at(clause.ops, 0))}`;
  return output;
};

/** Strip the `MAT ` prefix of an array operand. */
export const stripMat = (value: string): string =>
  value.startsWith("MAT ") ? value.slice(4) : value;

const noneClauses = (
  program: ExecutionProgram,
  rest: readonly ExecutionOp[],
): string => {
  let output = "";
  for (const clause of rest)
    if (clause.op === 0x2e && clause.m === 2)
      output += ` NONE ${program.lineRef(at(clause.ops, 0))}`;
  return output;
};

const onStatement = (
  program: ExecutionProgram,
  rest: readonly ExecutionOp[],
  stack: ExecutionStack,
): string => {
  const clause = rest[0];
  if (clause === undefined) return "ON ?";
  if (clause.op === 0x2c || (clause.op === 0x20 && clause.x !== null)) {
    const keyword = clause.op === 0x2c ? "GOTO" : "GOSUB";
    const targets = clause.op === 0x20 ? clause.ops : (rest[1]?.ops ?? []);
    return `ON ${text(stack.pop())} ${keyword} ${targets.map((value) => program.lineRef(value)).join(",")}${noneClauses(program, rest)}`;
  }
  let condition =
    EXEC_ON_CONDITIONS.get(clause.op) ?? `<?ON${hexUpper(clause.op, 2)}>`;
  if (clause.op === 0x26) condition += ` ${text(stack.pop())}`;
  const value = clause.ops[0] ?? 0;
  const target =
    value === 0xfffd
      ? "IGNORE"
      : value === 0xfffe
        ? "SYSTEM"
        : `GOTO ${program.lineRef(value)}`;
  return `ON ${condition} ${target}`;
};

const defStatement = (
  program: ExecutionProgram,
  head: ExecutionOp,
  stack: ExecutionStack,
): string => {
  const library = head.x === 0x2f;
  const params = stack.entries.filter((entry) => entry.p === -4);
  const functions = stack.entries.filter((entry) => entry.p === ATOM);
  const name = functions[1] === undefined ? "?" : text(functions[1]);
  const lengths = [...head.ops];
  const rendered: string[] = [];
  let lengthIndex = 0;
  for (const entry of params) {
    const param = entry.asg;
    if (param?.kind !== "param") continue;
    if (param.mode === ";") {
      rendered.push(";");
      continue;
    }
    if (param.name.startsWith("MAT ")) {
      rendered.push(param.name);
      continue;
    }
    let value = (param.mode === "ref" ? "&" : "") + param.name;
    if (param.mode !== "ref" && lengthIndex < lengths.length) {
      const length = at(lengths, lengthIndex);
      lengthIndex += 1;
      if (param.name.endsWith("$") && length !== 18)
        value += `*${String(length)}`;
    }
    rendered.push(value);
  }
  let output = `DEF ${library ? "LIBRARY " : ""}${name}`;
  if (name.endsWith("$") && functions[1] !== undefined) {
    const length = program.symbolLength(text(functions[1]));
    if (length !== undefined && length !== 0 && length !== 18)
      output += `*${String(length)}`;
  }
  if (rendered.length > 0) {
    let list = "";
    for (const value of rendered)
      if (value === ";") list += ";";
      else list += (list !== "" && !list.endsWith(";") ? "," : "") + value;
    output += `(${list})`;
  }
  return output;
};

const matStatement = (
  rest: readonly ExecutionOp[],
  stack: ExecutionStack,
): string => {
  const clause = rest[0]?.op;
  if (clause === 0x30 || clause === 0x31) {
    const source = stack.pop();
    const target = stack.pop();
    return `MAT ${stripMat(text(target))}=${clause === 0x30 ? "AIDX(" : "DIDX("}${stripMat(text(source))})`;
  }
  if (clause !== undefined && [0x0b, 0x0c, 0x08, 0x09].includes(clause)) {
    const right = stack.pop();
    const left = stack.pop();
    const target = stack.pop();
    return `MAT ${stripMat(text(target))}=${stripMat(text(left))}${EXEC_BINARY.get(clause) ?? ""}${stripMat(text(right))}`;
  }
  const value = stack.pop();
  if (stack.entries.length === 0) return `MAT ${stripMat(text(value))}`;
  const target = stack.pop();
  const source =
    text(value).startsWith("MAT ") || value.p < ATOM
      ? text(value)
      : `(${text(value)})`;
  return `MAT ${stripMat(text(target))}=${stripMat(source)}`;
};

const loopStatement = (
  head: ExecutionOp,
  stack: ExecutionStack,
): ExecutionItem[] => {
  if (head.op === 0x3b) {
    if (head.m !== 2) return [statementItem("DO")];
    const condition = text(stack.pop());
    return at(head.ops, 0) < 0x8000
      ? [statementItem(`DO WHILE ${condition}`)]
      : [
          statementItem(`DO UNTIL ${condition}`),
          { kind: "DROP", mode: "ELSE" },
        ];
  }
  if (head.m === 2)
    return [
      statementItem(`LOOP UNTIL ${text(stack.pop())}`),
      { kind: "DROP", mode: "ELSEGOTO" },
    ];
  if (head.ops[0] === 0xfffe)
    return [statementItem(`LOOP WHILE ${text(stack.pop())}`)];
  return [statementItem("LOOP")];
};

const formStatement = (
  program: ExecutionProgram,
  stack: ExecutionStack,
): string => {
  const first = stack.entries[0];
  const value = first === undefined ? "" : text(first);
  const raw = program.rawString(value);
  return `FORM ${
    raw === undefined
      ? value
      : decodeForm(
          raw,
          stack.entries.slice(1).map((entry) => text(entry)),
        )
  }`;
};

const forStatement = (stack: ExecutionStack): string => {
  const step = stack.pop();
  const limit = stack.pop();
  const initial = stack.pop();
  const stepText = text(step);
  return `FOR ${letText(initial)} TO ${text(limit)}${stepText === "1" ? "" : ` STEP ${stepText}`}`;
};

const executeStatement = (
  program: ExecutionProgram,
  keyword: string,
  rest: readonly ExecutionOp[],
  stack: ExecutionStack,
): string => {
  const args = stack.entries
    .filter((entry) => entry.p !== -3)
    .map((entry) => text(entry))
    .join(",");
  return `${keyword} ${args}${errorClauses(program, rest)}`;
};

const fallbackStatement = (
  keyword: string,
  rest: readonly ExecutionOp[],
  stack: ExecutionStack,
): string => {
  const parts = [
    keyword,
    ...rest.map(
      (clause) =>
        EXEC_CLAUSES.get(clause.op) ?? `<?C${hexUpper(clause.op, 2)}>`,
    ),
  ];
  const operands = stack.entries.map((entry) => text(entry)).join(" ");
  return parts.join(" ") + (operands === "" ? "" : ` {${operands}}`);
};

/** Control-flow statements whose operand is a jump target or block marker. */
const controlStatement = (
  program: ExecutionProgram,
  head: ExecutionOp,
  rest: readonly ExecutionOp[],
  stack: ExecutionStack,
): ExecutionItem[] | null => {
  const { op, m, x, ops } = head;
  if (op === 0x11 && stack.entries.length === 0)
    return [
      statementItem(
        `RESTORE${m === 2 ? ` ${program.lineRef(at(ops, 0))}` : ""}`,
      ),
    ];
  if (op === 0x28 && m === 2)
    return [statementItem(`IF ${text(stack.pop())}`), { kind: "THEN" }];
  if (op === 0x2c && m === 2)
    return [statementItem(`GOTO ${program.lineRef(at(ops, 0))}`)];
  if (op === 0x20 && m === 2 && x === null)
    return [statementItem(`GOSUB ${program.lineRef(at(ops, 0))}`)];
  if (op === 0x24 && m === 2) return [statementItem("ELSE")];
  if (op === 0x2f && m === 0 && rest[0]?.op === 0x28)
    return [statementItem("END IF")];
  if (op === 0x2d && m === 2) {
    const target = rest[0]?.op ?? 0;
    return [
      statementItem(
        `EXIT ${target === 0x3b ? "DO" : target === 0x22 ? "FOR" : "<?EXIT>"}`,
      ),
    ];
  }
  return null;
};

/** Decompile one statement from its op sequence and the operands pushed before it. */
export const decodeStatement = (
  program: ExecutionProgram,
  ops: readonly ExecutionOp[],
  stack: ExecutionStack,
): ExecutionItem[] => {
  const head = at(ops, 0);
  const { op, m, x } = head;
  const keyword = EXEC_STATEMENTS.get(op) ?? `<?K${hexUpper(op, 2)}>`;
  const rest = ops.slice(1);
  if (op === 0x01)
    return [
      statementItem(
        `LET ${letText(stack.pop())}${errorClauses(program, rest)}`,
      ),
    ];
  if ((op === 0x2c && m === 0) || (op === 0x20 && x !== null)) {
    const targets = op === 0x20 ? head.ops : (rest[0]?.ops ?? []);
    return [
      statementItem(
        `ON ${text(stack.pop())}${op === 0x20 ? " GOSUB " : " GOTO "}${targets.map((value) => program.lineRef(value)).join(",")}${noneClauses(program, rest)}`,
      ),
    ];
  }
  if (op === 0x29) return [statementItem(onStatement(program, rest, stack))];
  if (op === 0x26) return [statementItem(defStatement(program, head, stack))];
  const control = controlStatement(program, head, rest, stack);
  if (control !== null) return control;
  if (op === 0x02) return [statementItem(matStatement(rest, stack))];
  if (op === 0x22 && m === 3) return [statementItem(forStatement(stack))];
  if (op === 0x23 && m === 3)
    return [statementItem(`NEXT ${text(stack.pop())}`)];
  if (op === 0x3b || op === 0x3e) return loopStatement(head, stack);
  if (op === 0x1e) return [statementItem(formStatement(program, stack))];
  if (EXEC_IO_STATEMENTS.has(op))
    return [statementItem(ioStatement(program, keyword, ops, stack.entries))];
  if ((op === 0x36 || op === 0x31) && stack.entries.length > 0)
    return [statementItem(executeStatement(program, keyword, rest, stack))];
  if (m === 1 && EXEC_STATEMENTS.has(op)) return [statementItem(keyword)];
  return [statementItem(fallbackStatement(keyword, rest, stack))];
};
