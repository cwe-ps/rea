import type { BusinessRulesSource } from "../domain/businessRules/businessRulesArtifact.js";
import {
  appendBusinessRulesReference,
  emptyBusinessRulesReferences,
  projectBusinessRulesStatement,
  withoutBusinessRulesComments,
} from "./BusinessRulesReferences.js";
import { REFERENCE_STATEMENTS } from "./BusinessRulesTokens.js";

const NUMBERED_LINE = /^(\d{1,5})(?:[ \t]+|$)(.*)$/u;
const CONTINUATION = /!:\s*$/u;
const LABEL = /^([A-Za-z_][A-Za-z0-9_]*):(?!=)\s*/u;
const REMARK = /^REM\b/iu;
const STATEMENT = /^(OPEN|CHAIN|EXECUTE|LIBRARY|DEF)\b\s*([^]*)$/iu;
const STATEMENT_CODES: Readonly<Record<string, number>> = {
  OPEN: REFERENCE_STATEMENTS.open,
  CHAIN: REFERENCE_STATEMENTS.chain,
  EXECUTE: REFERENCE_STATEMENTS.execute,
  LIBRARY: REFERENCE_STATEMENTS.library,
  DEF: REFERENCE_STATEMENTS.def,
};
const NUMERIC_SOURCE_LINE = /^\d{1,5}[ \t]+\S/mu;
const SOURCE_KEYWORD =
  /\b(?:DIM|PRINT|INPUT|CHAIN|EXECUTE|GOTO|GOSUB|FNEND|REREAD|REWRITE|DEF\s+FN)\b|\b(?:OPEN|READ|WRITE)\s+#\s*\d+/iu;

/** Numbered BR statements with recognizable keywords in leading text. */
export const looksLikeBusinessRulesSource = (text: string): boolean =>
  NUMERIC_SOURCE_LINE.test(text) && SOURCE_KEYWORD.test(text);

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z0-9_$]/u.test(character);

/**
 * Split comment-free statement text where a new statement can begin inside
 * IF ... THEN ... ELSE ..., outside string literals.
 */
const statementStarts = (text: string): string[] => {
  const segments: string[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    const word = /^(?:THEN|ELSE)/iu.exec(text.slice(index, index + 4));
    if (
      word !== null &&
      !isWordCharacter(text[index - 1]) &&
      !isWordCharacter(text[index + 4])
    ) {
      segments.push(text.slice(start, index).trim());
      start = index + 4;
      index += 3;
    }
  }
  segments.push(text.slice(start).trim());
  return segments.filter((segment) => segment !== "");
};

interface LogicalLine {
  readonly number: number | null;
  readonly physicalLine: number;
  text: string;
}

type Location = { line: number | null; physical_line: number };
type SourceReferences = ReturnType<
  typeof emptyBusinessRulesReferences<Location>
>;

/** Numbered-line index plus logical lines with `!:` continuations joined. */
const splitLogicalLines = (
  text: string,
): {
  readonly lines: BusinessRulesSource["lines"];
  readonly logical: readonly LogicalLine[];
  readonly physicalLines: number;
  readonly unnumbered: boolean;
} => {
  const lines: BusinessRulesSource["lines"] = [];
  const logical: LogicalLine[] = [];
  const parts = text.split(/(\r\n|\n|\r)/u);
  let offset = 0;
  let unnumbered = false;
  let continued = false;
  for (let index = 0; index < parts.length; index += 2) {
    const raw = parts[index] ?? "";
    const physicalLine = index / 2 + 1;
    const numbered = NUMBERED_LINE.exec(raw);
    const previous = logical.at(-1);
    if (numbered !== null) {
      const number = Number.parseInt(numbered[1] ?? "", 10);
      lines.push({ number, physical_line: physicalLine, offset });
      logical.push({ number, physicalLine, text: numbered[2] ?? "" });
    } else if (continued && previous !== undefined) previous.text += `\n${raw}`;
    else if (raw.trim() !== "") {
      unnumbered = true;
      logical.push({ number: null, physicalLine, text: raw });
    }
    continued = CONTINUATION.test(raw);
    offset += raw.length + (parts[index + 1] ?? "").length;
  }
  // A trailing line break does not start another physical line.
  const physicalLines =
    parts.length === 1 && parts[0] === ""
      ? 0
      : (parts.length + 1) / 2 - (parts.at(-1) === "" ? 1 : 0);
  return { lines, logical, physicalLines, unnumbered };
};

/** Record one logical line's label and statement references. */
const indexLogicalLine = (
  line: LogicalLine,
  labels: BusinessRulesSource["labels"],
  references: SourceReferences,
): void => {
  let body = withoutBusinessRulesComments(line.text).trim();
  if (body === "" || REMARK.test(body)) return;
  const location = { line: line.number, physical_line: line.physicalLine };
  const label = LABEL.exec(body);
  if (label !== null) {
    labels.push({ name: label[1] ?? "", ...location });
    body = body.slice(label[0].length);
  }
  for (const segment of statementStarts(body)) {
    const statement = STATEMENT.exec(segment);
    const code = STATEMENT_CODES[(statement?.[1] ?? "").toUpperCase()];
    if (statement === null || code === undefined) continue;
    const reference = projectBusinessRulesStatement(
      code,
      (statement[2] ?? "").trim(),
    );
    if (reference !== null)
      appendBusinessRulesReference(references, location, reference);
  }
};

/**
 * Index plain-text BR source (.brs/.wbs) or an unnumbered procedure script
 * (.prc): numbered lines with byte offsets, labels, and OPEN/CHAIN/EXECUTE/
 * LIBRARY/DEF operands projected exactly as for compiled listings. `text`
 * must be Latin-1 decoded so offsets are byte offsets.
 */
export const indexBusinessRulesSource = (text: string): BusinessRulesSource => {
  const { lines, logical, physicalLines, unnumbered } = splitLogicalLines(text);
  const labels: BusinessRulesSource["labels"] = [];
  const references = emptyBusinessRulesReferences<Location>();
  for (const line of logical) indexLogicalLine(line, labels, references);
  return {
    numbering:
      lines.length === 0 ? "unnumbered" : unnumbered ? "mixed" : "numbered",
    physical_lines: physicalLines,
    lines,
    labels,
    references: { evidence_kind: "derived", ...references },
  };
};
