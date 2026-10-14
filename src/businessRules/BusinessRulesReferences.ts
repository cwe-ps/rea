import type { BusinessRulesProgram } from "../domain/businessRules/businessRulesProgram.js";
import {
  businessRulesKeyword,
  renderBusinessRulesTokens,
  type BusinessRulesToken,
} from "./BusinessRulesDecoder.js";
import { REFERENCE_STATEMENTS } from "./BusinessRulesTokens.js";

type ProgramReferences = Omit<
  BusinessRulesProgram["references"],
  "evidence_kind" | "status"
>;

type Unlocated<T> = T extends readonly (infer Item)[]
  ? Omit<Item, "line">
  : never;

/** Location-free operand values per reference list. */
type ReferenceValues = {
  readonly [Kind in keyof ProgramReferences]: Unlocated<
    ProgramReferences[Kind]
  >;
};

/** Reference lists whose items carry a caller-chosen location. */
export type BusinessRulesReferenceLists<Location> = {
  [Kind in keyof ReferenceValues]: (Location & ReferenceValues[Kind])[];
};

type References = BusinessRulesReferenceLists<{ line: number }>;

/** One decoded record's line number and tokens. */
export interface BusinessRulesTokenizedRecord {
  readonly number: number;
  readonly tokens: readonly BusinessRulesToken[];
}

/** Remove `!` comments outside string literals, joining physical lines with a space. */
export const withoutBusinessRulesComments = (text: string): string => {
  let output = "";
  let quote: string | null = null;
  let comment = false;
  for (const character of text) {
    if (comment) {
      if (character === "\n") {
        comment = false;
        output += " ";
      }
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "!") {
      comment = true;
      continue;
    }
    output += character === "\n" ? " " : character;
  }
  return output;
};

/** Split at a separator outside string literals and parentheses. */
const splitTopLevel = (text: string, separator: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  for (const character of text) {
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts;
};

/** Value of a single quoted literal with doubled-quote escapes, else null. */
const stringLiteral = (expression: string): string | null => {
  const match = /^(["'])((?:(?!\1)[^]|\1\1)*)\1$/u.exec(expression);
  if (match === null) return null;
  const quote = match[1] ?? '"';
  return (match[2] ?? "").replaceAll(quote + quote, quote);
};

const FUNCTION_NAME = /FN[A-Z0-9_]*\$?/giu;

const statementSegments = (
  tokens: readonly BusinessRulesToken[],
): { readonly code: number; readonly text: string }[] => {
  const segments: { code: number; text: string }[] = [];
  let start = -1;
  const close = (end: number): void => {
    const first = tokens[start];
    if (first?.group !== 1) return;
    const word = businessRulesKeyword(1, first.code);
    const text = renderBusinessRulesTokens(tokens.slice(start, end));
    segments.push({
      code: first.code,
      text: withoutBusinessRulesComments(text.slice(word.length)).trim(),
    });
  };
  for (const [index, token] of tokens.entries())
    if (token.group === 1) {
      if (start >= 0) close(index);
      start = index;
    }
  if (start >= 0) close(tokens.length);
  return segments;
};

/** One statement's reference operands, before a source location is attached. */
export type BusinessRulesStatementReference =
  | {
      readonly kind: "files_opened";
      readonly value: ReferenceValues["files_opened"];
    }
  | {
      readonly kind: "programs_chained";
      readonly value: ReferenceValues["programs_chained"];
    }
  | {
      readonly kind: "commands_executed";
      readonly value: ReferenceValues["commands_executed"];
    }
  | {
      readonly kind: "libraries";
      readonly value: ReferenceValues["libraries"];
    }
  | {
      readonly kind: "functions_defined";
      readonly value: ReferenceValues["functions_defined"];
    };

/**
 * Project one statement's OPEN/CHAIN/EXECUTE/LIBRARY/DEF operands from its
 * keyword code and comment-free text after the keyword; other statements yield null.
 */
export const projectBusinessRulesStatement = (
  code: number,
  text: string,
): BusinessRulesStatementReference | null => {
  if (code === REFERENCE_STATEMENTS.open) {
    // A channel may be assigned inline (`#H:=FNHANDLE:`); `:=` is not the separator.
    const match = /^#\s*((?:[^:]|:=)*?)\s*:(?!=)\s*([^]*)$/u.exec(text);
    const expression = splitTopLevel(match?.[2] ?? text, ",")[0] ?? "";
    const literal = stringLiteral(expression);
    const name =
      literal === null
        ? null
        : (/(?:^|,)\s*NAME\s*=\s*([^,]*)/iu.exec(literal)?.[1]?.trim() ?? null);
    return {
      kind: "files_opened",
      value: { channel: match?.[1] ?? null, expression, literal, name },
    };
  }
  if (
    code === REFERENCE_STATEMENTS.chain ||
    code === REFERENCE_STATEMENTS.execute
  ) {
    const expression = splitTopLevel(text, ",")[0] ?? "";
    return {
      kind:
        code === REFERENCE_STATEMENTS.chain
          ? "programs_chained"
          : "commands_executed",
      value: { expression, literal: stringLiteral(expression) },
    };
  }
  if (code === REFERENCE_STATEMENTS.library) {
    const [before = "", ...after] = splitTopLevel(text, ":");
    const operands = splitTopLevel(before, ",").filter(
      (operand) => operand !== "" && !/^(?:RELEASE|NOFILES)$/iu.test(operand),
    );
    const expression = operands.at(-1) ?? null;
    return {
      kind: "libraries",
      value: {
        expression,
        literal: expression === null ? null : stringLiteral(expression),
        functions: after.join(":").match(FUNCTION_NAME) ?? [],
      },
    };
  }
  if (code === REFERENCE_STATEMENTS.def) {
    const name = text.match(FUNCTION_NAME)?.[0];
    return name === undefined
      ? null
      : {
          kind: "functions_defined",
          value: { name, library: /^LIBRARY\b/iu.test(text) },
        };
  }
  return null;
};

/** Empty reference lists in their canonical key order. */
export const emptyBusinessRulesReferences = <
  Location,
>(): BusinessRulesReferenceLists<Location> => ({
  files_opened: [],
  programs_chained: [],
  commands_executed: [],
  libraries: [],
  functions_defined: [],
});

/** Append one projected statement reference at a caller-chosen location. */
export const appendBusinessRulesReference = <Location>(
  references: BusinessRulesReferenceLists<Location>,
  location: Location,
  reference: BusinessRulesStatementReference,
): void => {
  switch (reference.kind) {
    case "files_opened":
      references.files_opened.push({ ...location, ...reference.value });
      return;
    case "programs_chained":
      references.programs_chained.push({ ...location, ...reference.value });
      return;
    case "commands_executed":
      references.commands_executed.push({ ...location, ...reference.value });
      return;
    case "libraries":
      references.libraries.push({ ...location, ...reference.value });
      return;
    case "functions_defined":
      references.functions_defined.push({ ...location, ...reference.value });
      return;
  }
};

/** Project OPEN/CHAIN/EXECUTE/LIBRARY/DEF operands from decoded statement tokens. */
export const deriveBusinessRulesReferences = (
  records: readonly BusinessRulesTokenizedRecord[],
): References => {
  const references = emptyBusinessRulesReferences<{ line: number }>();
  for (const record of records)
    for (const { code, text } of statementSegments(record.tokens)) {
      const reference = projectBusinessRulesStatement(code, text);
      if (reference !== null)
        appendBusinessRulesReference(
          references,
          { line: record.number },
          reference,
        );
    }
  return references;
};

const REFERENCE_KEYWORDS = Object.values(REFERENCE_STATEMENTS).map((code) => ({
  code,
  word: businessRulesKeyword(1, code),
}));

/**
 * Re-tokenize decompiled statement texts (uppercase, before output case
 * conversion) so references derive through the same projection as saved-LIST
 * records. Only reference-bearing statements are kept.
 */
export const executionReferenceRecords = (
  lines: readonly {
    readonly number: number;
    readonly statements: readonly string[];
  }[],
): BusinessRulesTokenizedRecord[] =>
  lines.map(({ number, statements }) => ({
    number,
    tokens: statements.flatMap((statement): BusinessRulesToken[] => {
      const keyword = REFERENCE_KEYWORDS.find(
        ({ word }) => statement === word || statement.startsWith(`${word} `),
      );
      return keyword === undefined
        ? []
        : [
            { group: 1, code: keyword.code },
            { group: 5, text: statement.slice(keyword.word.length).trim() },
          ];
    }),
  }));
