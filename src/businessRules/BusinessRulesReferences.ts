import type { BusinessRulesProgram } from "../domain/businessRules/businessRulesProgram.js";
import {
  businessRulesKeyword,
  renderBusinessRulesTokens,
  type BusinessRulesToken,
} from "./BusinessRulesDecoder.js";
import { REFERENCE_STATEMENTS } from "./BusinessRulesTokens.js";

type References = Omit<
  BusinessRulesProgram["references"],
  "evidence_kind" | "status"
>;

/** One decoded record's line number and tokens. */
export interface BusinessRulesTokenizedRecord {
  readonly number: number;
  readonly tokens: readonly BusinessRulesToken[];
}

/** Remove `!` comments outside string literals while keeping physical lines. */
const withoutComments = (text: string): string => {
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
      text: withoutComments(text.slice(word.length)).trim(),
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

/** Project OPEN/CHAIN/LIBRARY/DEF operands from decoded statement tokens. */
export const deriveBusinessRulesReferences = (
  records: readonly BusinessRulesTokenizedRecord[],
): References => {
  const references: References = {
    files_opened: [],
    programs_chained: [],
    libraries: [],
    functions_defined: [],
  };
  for (const record of records)
    for (const { code, text } of statementSegments(record.tokens)) {
      const line = record.number;
      if (code === REFERENCE_STATEMENTS.open) {
        // A channel may be assigned inline (`#H:=FNHANDLE:`); `:=` is not the separator.
        const match = /^#\s*((?:[^:]|:=)*?)\s*:(?!=)\s*([^]*)$/u.exec(text);
        const expression = splitTopLevel(match?.[2] ?? text, ",")[0] ?? "";
        const literal = stringLiteral(expression);
        const name =
          literal === null
            ? null
            : (/(?:^|,)\s*NAME\s*=\s*([^,]*)/iu.exec(literal)?.[1]?.trim() ??
              null);
        references.files_opened.push({
          line,
          channel: match?.[1] ?? null,
          expression,
          literal,
          name,
        });
      } else if (code === REFERENCE_STATEMENTS.chain) {
        const expression = splitTopLevel(text, ",")[0] ?? "";
        references.programs_chained.push({
          line,
          expression,
          literal: stringLiteral(expression),
        });
      } else if (code === REFERENCE_STATEMENTS.library) {
        const [before = "", ...after] = splitTopLevel(text, ":");
        const operands = splitTopLevel(before, ",").filter(
          (operand) =>
            operand !== "" && !/^(?:RELEASE|NOFILES)$/iu.test(operand),
        );
        const expression = operands.at(-1) ?? null;
        references.libraries.push({
          line,
          expression,
          literal: expression === null ? null : stringLiteral(expression),
          functions: after.join(":").match(FUNCTION_NAME) ?? [],
        });
      } else if (code === REFERENCE_STATEMENTS.def) {
        const name = text.match(FUNCTION_NAME)?.[0];
        if (name !== undefined)
          references.functions_defined.push({
            line,
            name,
            library: /^LIBRARY\b/iu.test(text),
          });
      }
    }
  return references;
};
