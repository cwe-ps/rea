import { businessRulesKeyword } from "./BusinessRulesDecoder.js";
import {
  at,
  byteAt,
  latin1,
  type ExecutionItem,
} from "./BusinessRulesExecutionModel.js";
import {
  BUSINESS_RULES_CLAUSES,
  BUSINESS_RULES_STATEMENTS,
} from "./BusinessRulesTokens.js";
import {
  EXEC_BUILTIN_WORDS,
  EXEC_KEYWORD_WORDS,
} from "./BusinessRulesExecutionVocabulary.js";

const WORD = /[A-Za-z_][A-Za-z0-9_]*\$?/y;
const ALPHANUMERIC = /[\p{L}\p{N}_]/u;

/** Builtins lowercase; other identifiers Title_Case per underscore-separated part. */
const identifierCase = (word: string): string => {
  const lower = word.toLowerCase();
  if (EXEC_BUILTIN_WORDS.has(lower)) return lower;
  return word
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join("_");
};

/**
 * Apply the output case convention outside string literals: keywords
 * (when `keywords` is set) and builtin functions lowercase, other identifiers
 * Title_Case per underscore part. Compiled programs store identifiers
 * uppercase, so original case is not recoverable.
 */
export const applyOutputCase = (value: string, keywords: boolean): string => {
  let output = "";
  let index = 0;
  while (index < value.length) {
    const character = value.charAt(index);
    if (character === '"' || character === "'") {
      const close = value.indexOf(character, index + 1);
      const end = close < 0 ? value.length : close + 1;
      output += value.slice(index, end);
      index = end;
      continue;
    }
    WORD.lastIndex = index;
    const match = WORD.exec(value);
    if (
      match !== null &&
      (index === 0 || !ALPHANUMERIC.test(value.charAt(index - 1)))
    ) {
      const [word] = match;
      output +=
        keywords && EXEC_KEYWORD_WORDS.has(word)
          ? word.toLowerCase()
          : identifierCase(word);
      index += word.length;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
};

type KeywordToken = { readonly kind: "K1" | "K2"; readonly code: number };
type IndentToken = { readonly kind: "IND"; readonly spaces: number };
type EmbeddedToken =
  | KeywordToken
  | IndentToken
  | { readonly kind: "T3" | "T4" | "T5" | "T6" | "C"; readonly text: string };

/** Keyword, indentation, label (T4), comment (T6) or merged expression text (X). */
type Segment =
  | KeywordToken
  | IndentToken
  | { readonly kind: "T4" | "T6" | "X"; readonly text: string };

const embeddedTokens = (body: Uint8Array): EmbeddedToken[] => {
  const tokens: EmbeddedToken[] = [];
  let index = 0;
  while (index < body.length) {
    const code = byteAt(body, index);
    if (code === 0) break;
    if (code === 1 || code === 2) {
      tokens.push({
        kind: code === 1 ? "K1" : "K2",
        code: body[index + 1] ?? 0,
      });
      index += 2;
    } else if (code >= 3 && code <= 6) {
      const size =
        code === 3 ? (body[index + 1] ?? 0) : byteAt(body, index + 1);
      const value = latin1(body.subarray(index + 2, index + 2 + size));
      tokens.push({ kind: `T${String(code)}` as "T3", text: value });
      index += 2 + size;
    } else if (code === 7) {
      tokens.push({ kind: "IND", spaces: byteAt(body, index + 1) });
      index += 2;
    } else {
      tokens.push({ kind: "C", text: String.fromCharCode(code) });
      index += 1;
    }
  }
  return tokens;
};

const segmentsOf = (tokens: readonly EmbeddedToken[]): Segment[] => {
  const segments: Segment[] = [];
  for (const token of tokens) {
    const last = segments.at(-1);
    if (token.kind === "C" && last?.kind === "T6") {
      segments[segments.length - 1] = {
        kind: "T6",
        text: last.text + token.text,
      };
      continue;
    }
    if (token.kind === "T3" || token.kind === "T5" || token.kind === "C") {
      if (last?.kind === "X")
        segments[segments.length - 1] = {
          kind: "X",
          text: last.text + token.text,
        };
      else segments.push({ kind: "X", text: token.text });
    } else if ("code" in token || "spaces" in token) segments.push(token);
    else if (token.kind === "T4" || token.kind === "T6")
      segments.push({ kind: token.kind, text: token.text });
  }
  return segments;
};

const LEXI_DIRECTIVE = /^! ?(#(?:Select|Case|Case Else|End Select)#.*)$/isu;
/** Latin-1 characters the reference treats as whitespace. */
const WHITESPACE = new Set("\t\n\v\f\r\u001c\u001d\u001e\u001f \u0085\u00a0");

/** `! .  ! text` (Lexi indented comment) becomes `! text`. */
const indentedComment = (comment: string): string => {
  if (!comment.startsWith("! .")) return comment;
  let index = 3;
  while (WHITESPACE.has(comment.charAt(index))) index += 1;
  return comment.charAt(index) === "!" ? comment.slice(index) : comment;
};

const keywordWord = (kind: "K1" | "K2", code: number): string => {
  const table =
    kind === "K1" ? BUSINESS_RULES_STATEMENTS : BUSINESS_RULES_CLAUSES;
  return table.has(code)
    ? businessRulesKeyword(kind === "K1" ? 1 : 2, code)
    : `<?${kind}:${String(code)}>`;
};

/** True when no space follows a keyword before the next segment. */
const keywordAbutsNext = (
  word: string,
  next: Segment | undefined,
  after: Segment | undefined,
): boolean => {
  if (word === "" || next === undefined || word.endsWith("=")) return true;
  if (next.kind === "X") {
    const first = next.text.slice(0, 1);
    return first === "" || ",;) ".includes(first);
  }
  if (next.kind === "K1" && next.code === 0)
    return (
      after === undefined ||
      after.kind === "T6" ||
      (after.kind === "X" && after.text.startsWith(" "))
    );
  return next.kind === "IND";
};

/**
 * Render a saved-LIST record embedded in the execution stream (DIM and DATA
 * lines keep their source tokens even in stripped programs), with the same
 * case convention as decompiled lines.
 */
export const renderEmbeddedRecord = (body: Uint8Array): string => {
  const tokens = embeddedTokens(body);
  const comments = tokens.flatMap((token) =>
    token.kind === "T6" ? [token.text] : [],
  );
  const lastComment = comments.at(-1);
  const directive =
    lastComment === undefined ? null : LEXI_DIRECTIVE.exec(lastComment);
  if (directive !== null) {
    const first = tokens[0];
    return (
      " ".repeat(first?.kind === "IND" ? first.spaces : 0) +
      (directive[1] ?? "")
    );
  }
  const segments = segmentsOf(tokens);
  let output = "";
  // A comment is separated by a space once any segment (even an empty one) was emitted.
  let emitted = false;
  let first = true;
  for (const [index, segment] of segments.entries()) {
    const emittedBefore = emitted;
    emitted = true;
    if (segment.kind === "IND") {
      output += first ? " ".repeat(segment.spaces) : " ";
      continue;
    }
    first = false;
    if (segment.kind === "K1" || segment.kind === "K2") {
      const word = keywordWord(segment.kind, segment.code);
      output += word.toLowerCase();
      if (!keywordAbutsNext(word, segments[index + 1], segments[index + 2]))
        output += " ";
    } else if (segment.kind === "T6") {
      const comment = indentedComment(segment.text);
      if (emittedBefore && !WHITESPACE.has(output.slice(-1))) output += " ";
      output += comment;
    } else if (segment.kind === "X")
      output += applyOutputCase(segment.text, false);
    else if ("text" in segment) output += segment.text;
  }
  return output;
};

const DEF_ONE_LINE_END = new Set(["FNEND", "<?K27>"]);

/** Fold `DEF FNX: LET FNX=expr: FNEND` into `DEF FNX=expr`, dropping a leading GOTO. */
const foldOneLineDef = (items: ExecutionItem[]): ExecutionItem[] => {
  const isDef = (item: ExecutionItem): boolean =>
    item.kind === "S" && item.text.startsWith("DEF ");
  let index = items.findIndex(isDef);
  if (index < 0) return items;
  const before = items.slice(0, index).filter((item) => item.kind === "S");
  const previous = before.at(-1);
  if (previous?.kind === "S" && previous.text.startsWith("GOTO ")) {
    items = [
      ...items.slice(0, index).filter((item) => item.kind !== "S"),
      ...items.slice(index),
    ];
    index = items.findIndex(isDef);
  }
  const definition = at(items, index);
  const body = items
    .slice(index + 1)
    .flatMap((item) => (item.kind === "S" ? [item.text] : []));
  const [assignment, end] = body;
  if (
    definition.kind === "S" &&
    body.length === 2 &&
    assignment?.startsWith("LET ") === true &&
    end !== undefined &&
    DEF_ONE_LINE_END.has(end)
  ) {
    const separator = assignment.indexOf("=");
    const expression = separator < 0 ? "" : assignment.slice(separator + 1);
    return [
      ...items.slice(0, index),
      { kind: "S", text: `${definition.text}=${expression}` },
    ];
  }
  return items;
};

/** Remove the ELSE/GOTO scaffolding compiled for DO UNTIL and LOOP UNTIL. */
const dropLoopScaffolding = (
  items: readonly ExecutionItem[],
): ExecutionItem[] => {
  const clean: ExecutionItem[] = [];
  let drop: "ELSE" | "ELSEGOTO" | "ELSEMARK" | null = null;
  for (const item of items) {
    if (item.kind === "DROP") {
      drop = item.mode;
      continue;
    }
    if (drop === "ELSE" && item.kind === "S" && item.text === "ELSE") {
      drop = "ELSEMARK";
      continue;
    }
    if (
      drop === "ELSEGOTO" &&
      item.kind === "S" &&
      item.text.startsWith("GOTO ")
    ) {
      drop = null;
      continue;
    }
    if (drop !== null && item.kind === "ELSE") {
      if (drop === "ELSEMARK") drop = null;
      continue;
    }
    clean.push(item);
  }
  return clean;
};

/** Laid-out line text and the statement texts it contains. */
export interface RenderedExecutionLine {
  readonly text: string;
  readonly statements: readonly string[];
}

/**
 * Lay out one line's statements: `:` between statements, `THEN`/`ELSE`
 * markers, and `!:` continuations where the compiled code kept an empty
 * statement after a THEN or ELSE.
 */
export const renderExecutionItems = (
  decoded: readonly ExecutionItem[],
): RenderedExecutionLine => {
  const items = dropLoopScaffolding(foldOneLineDef([...decoded]));
  let output = "";
  let previous: string | null = null;
  for (const item of items) {
    if (item.kind === "S") {
      if (output !== "" && previous !== "THEN" && previous !== "ELSE") {
        if (previous === "S")
          output +=
            item.text.startsWith("IF ") && output.endsWith("ELSE")
              ? " "
              : " : ";
        else if (previous === "NL") output += " ";
        else output += " !:\n ";
      } else if (output !== "") output += " ";
      output += item.text;
    } else if (item.kind === "THEN") output += " THEN";
    else if (item.kind === "ELSE") output += " ELSE";
    if (item.kind === "SEP" && (previous === "THEN" || previous === "ELSE")) {
      output += " !:\n";
      previous = "NL";
      continue;
    }
    previous =
      item.kind === "SEP" ? (previous === "NL" ? "NL" : "SEP") : item.kind;
  }
  while (output.endsWith(" !:\n")) output = output.slice(0, -4);
  return {
    text: output,
    statements: items.flatMap((item) => (item.kind === "S" ? [item.text] : [])),
  };
};
