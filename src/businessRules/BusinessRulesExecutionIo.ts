import {
  at,
  Expr,
  hexUpper,
  text,
  type ExecutionOp,
  type ExecutionProgram,
} from "./BusinessRulesExecutionModel.js";
import {
  ATOM,
  EXEC_ARGUMENT_CLAUSES,
  EXEC_CLAUSES,
  EXEC_ERROR_CLAUSES,
  EXEC_POSITION_CLAUSES,
} from "./BusinessRulesExecutionVocabulary.js";

const errorTarget = (program: ExecutionProgram, value: number): string =>
  value === 0xfffd
    ? "IGNORE"
    : value === 0xfffe
      ? "SYSTEM"
      : program.lineRef(value);

/** Statement-header expressions consumed in order by clauses. */
class HeaderCursor {
  position = 0;

  constructor(readonly entries: readonly Expr[]) {}

  get remaining(): boolean {
    return this.position < this.entries.length;
  }

  next(): string {
    const entry = this.entries[this.position];
    if (entry === undefined) return "<?H>";
    this.position += 1;
    return text(entry);
  }
}

/** PRINT separator run: `(type << 3) | count`, type 1 `,` and 2 `;`. */
const separatorKind = (code: number): string | undefined =>
  ({ 1: ",", 2: ";" })[(code >> 3) & 3];

/** Parenthesized sub-lists introduced by a `<?BInn>` count marker. */
const groupItems = (items: readonly Expr[]): Expr[] => {
  const output: Expr[] = [];
  for (let index = 0; index < items.length;) {
    const entry = at(items, index);
    const value = entry.t;
    if (
      entry.p === ATOM &&
      typeof value === "string" &&
      value.startsWith("<?BI") &&
      value.length === 7
    ) {
      const count = Number.parseInt(value.slice(4, 6), 16);
      if (count > 0) {
        const group = items.slice(index + 1, index + 1 + count);
        output.push(new Expr(`(${group.map((item) => text(item)).join(",")})`));
        index += 1 + count;
        continue;
      }
    }
    output.push(entry);
    index += 1;
  }
  return output;
};

interface ClauseState {
  head: string;
  readonly parts: string[];
  readonly errors: string[];
  readonly separators: string[];
  trailing: string;
}

/** Clause rendering context for one I/O statement. */
interface ClauseContext {
  readonly program: ExecutionProgram;
  readonly statement: number;
  /** FIELDS/SELECT present: USING and HELP clauses then carry HELP text. */
  readonly fields: boolean;
  readonly header: HeaderCursor;
  readonly state: ClauseState;
}

/** Statement-specific clauses (channel, screen and help forms). Returns false when not one. */
const specialClause = (
  context: ClauseContext,
  current: ExecutionOp,
): boolean => {
  const { program, statement, fields, header, state } = context;
  const { op: code, m } = current;
  const { parts } = state;
  if (code === 0x10) {
    const entry = header.entries[header.position] ?? new Expr("<?H>");
    header.next();
    state.head = `#${entry.p >= ATOM ? text(entry) : `(${text(entry)})`}`;
  } else if (statement === 0x18 && code === 0x0f)
    parts.push(`BORDER${header.remaining ? ` ${header.next()}` : ""}`);
  else if (statement === 0x12 && code === 0x02) parts.push("SQL");
  else if (code === 0x25) parts.push("KEYONLY");
  else if (statement === 0x19 && (code === 0x21 || code === 0x24) && m !== 2) {
    if (code === 0x24 && parts.at(-1) === "MENU")
      parts[parts.length - 1] = "MENU STATUS";
    else parts.push(code === 0x21 ? "MENU" : "STATUS");
  } else if ((code === 0x12 || code === 0x23) && m === 2 && fields)
    state.errors.push(`HELP ${program.lineRef(at(current.ops, 0))}`);
  else if (statement === 0x10 && (code === 0x20 || code === 0x21))
    parts.push(
      (code === 0x20 ? "BUTTONS" : "MENU") +
        (header.remaining ? ` ${header.next()}` : ""),
    );
  else if (code === 0x12 && fields) parts.push(`HELP ${header.next()}`);
  else return false;
  return true;
};

/** Render one non-list clause into the statement parts or error clauses. */
const clause = (context: ClauseContext, current: ExecutionOp): void => {
  if (specialClause(context, current)) return;
  const { program, header, state } = context;
  const { op: code, m, ops: operands } = current;
  const argument = EXEC_ARGUMENT_CLAUSES.get(code);
  if (argument !== undefined) {
    const value = header.next();
    state.parts.push(argument + (argument.endsWith("=") ? "" : " ") + value);
  } else if (code === 0x11 && m === 2)
    state.parts.push(`USING ${program.lineRef(at(operands, 0))}`);
  else if ((EXEC_ERROR_CLAUSES.has(code) || code === 0x23) && m === 2)
    state.errors.push(
      `${EXEC_CLAUSES.get(code) ?? "?"} ${errorTarget(program, at(operands, 0))}`,
    );
  else
    state.parts.push(
      EXEC_POSITION_CLAUSES.get(code) ??
        EXEC_CLAUSES.get(code) ??
        `<?C${hexUpper(code, 2)}>`,
    );
};

/** Append a PRINT separator run; returns false once the list's final run is read. */
const separatorRun = (state: ClauseState, current: ExecutionOp): boolean => {
  const { op: code, m } = current;
  if (code >= 0x20 || m === 1) {
    const kind = separatorKind(code) ?? "";
    const count = code & 7;
    if (kind !== "" && count !== 0) {
      state.separators.push(...Array<string>(count - 1).fill(kind));
      state.trailing = kind;
    }
    return false;
  }
  state.separators.push(
    ...Array<string>(code & 7).fill(separatorKind(code) ?? ","),
  );
  return true;
};

/** Walk the clause ops, collecting PRINT separators, parts and error clauses. */
const clauses = (
  program: ExecutionProgram,
  ops: readonly ExecutionOp[],
  header: HeaderCursor,
): ClauseState => {
  const statement = at(ops, 0).op;
  const state: ClauseState = {
    head: "",
    parts: [],
    errors: [],
    separators: [],
    trailing: "",
  };
  const context: ClauseContext = {
    program,
    statement,
    fields: ops
      .slice(1)
      .some((current) => current.op === 0x13 || current.op === 0x0b),
    header,
    state,
  };
  let printList = false;
  for (const current of ops.slice(1)) {
    const { op: code, m } = current;
    if (printList) printList = separatorRun(state, current);
    else if (code === 0x14 && m === 0 && statement === 0x18) printList = true;
    else if (code === 0x2f && m === 1) break;
    else clause(context, current);
  }
  return state;
};

const listText = (items: readonly Expr[], state: ClauseState): string => {
  if (state.separators.length === 0 && state.trailing === "")
    return items.map((item) => text(item)).join(",");
  let output = "";
  for (const [index, item] of items.entries()) {
    output += text(item);
    if (index < items.length - 1) output += state.separators[index] ?? ",";
  }
  return output + state.trailing;
};

/**
 * Decode an I/O statement. Stack entries before the last I/O-list separator
 * are list items; entries after it are header expressions consumed by
 * channel and argument clauses in order.
 */
export const ioStatement = (
  program: ExecutionProgram,
  keyword: string,
  ops: readonly ExecutionOp[],
  stack: readonly Expr[],
): string => {
  const op = at(ops, 0).op;
  let separator = -1;
  for (const [index, entry] of stack.entries())
    if (entry.p === -3) separator = index;
  let items = separator >= 0 ? stack.slice(0, separator) : [];
  const header = new HeaderCursor(stack.slice(separator + 1));
  const state = clauses(program, ops, header);
  if (op === 0x0d) {
    const path = header.entries[0] === undefined ? "" : text(header.entries[0]);
    const functions = stack
      .filter((entry) => text(entry).startsWith("<LIBFN "))
      .map((entry) => text(entry).slice(7, -1));
    return `LIBRARY ${path}: ${functions.join(",")}`;
  }
  if (
    items.length === 0 &&
    separator < 0 &&
    [0x18, 0x19, 0x1b, 0x1a, 0x10, 0x14].includes(op)
  )
    items = header.entries.slice(header.position);
  items = groupItems(items);
  let list = listText(items, state);
  let { parts } = state;
  const { head, errors } = state;
  const errorText = errors.length > 0 ? ` ${errors.join(" ")}` : "";
  if (op === 0x10)
    return `DISPLAY ${parts.join(",")}${list === "" ? "" : `: ${list}`}${errorText}`;
  const second = items[1];
  if (op === 0x12 && parts.includes("SQL") && second !== undefined) {
    parts = parts.map((part) =>
      part === "SQL" ? `SQL ${text(second)}` : part,
    );
    list = text(at(items, 0));
  }
  let output: string;
  if (op === 0x12)
    output = `${keyword} ${head}: ${list}${parts.length > 0 ? `,${parts.join(",")}` : ""}`;
  else if (head === "" && parts.length === 0)
    output = keyword + (list === "" ? "" : ` ${list}`);
  else {
    const prefix = [...(head === "" ? [] : [head]), ...parts].join(",");
    output =
      keyword +
      (prefix === "" ? "" : ` ${prefix}`) +
      (list !== "" || head !== "" ? `: ${list}` : "");
  }
  return output + errorText;
};
