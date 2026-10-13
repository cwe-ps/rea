import type { BusinessRulesArtifact } from "../domain/businessrules/businessRulesArtifact.js";

type SourceIndex = Extract<
  BusinessRulesArtifact,
  { format: "br-source" }
>["source"];

type SourceReference = SourceIndex["references"][number];

const NUMBERED_LINE = /^(\d{1,5})(?:[ \t]+|$)(.*)$/u;
const DEF_FN = /\bDEF\s+(FN[A-Za-z0-9_$]*)(?:\*\d+)?\s*(\([^)]*\))?/iu;
const FNEND = /^FNEND\b/iu;
const LABEL = /^([A-Za-z][A-Za-z0-9_$]*):/u;
const OPEN_STATEMENT = /\bOPEN\s+#(\d+)\s*:\s*("([^"]*)")?/giu;
const CHAIN_STATEMENT = /\bCHAIN\s+(?:"([^"]*)")?/giu;
const EXECUTE_STATEMENT = /\bEXECUTE\s+(?:"([^"]*)")?/giu;
const NAME_PARAMETER = /(?:^|,)\s*NAME=([^,]*)/iu;

/** Strip a trailing `!` comment outside quoted string literals. */
const stripComment = (text: string): string => {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') quoted = !quoted;
    if (char === "!" && !quoted) return text.slice(0, index);
  }
  return text;
};

const openReference = (
  match: RegExpExecArray,
  location: { line: number | null; statement: number },
): SourceReference => {
  const quoted = match[3];
  const name = quoted?.match(NAME_PARAMETER)?.[1]?.trim();
  // An empty NAME= means the target is built by a dynamic expression.
  const target =
    name !== undefined && name !== ""
      ? name
      : quoted !== undefined && !NAME_PARAMETER.test(quoted)
        ? quoted
        : null;
  return {
    kind: "open",
    line: location.line,
    statement: location.statement,
    channel: Number.parseInt(match[1] ?? "0", 10),
    target,
    detail: match[0],
  };
};

const simpleReference = (
  kind: "chain" | "execute",
  match: RegExpExecArray,
  location: { line: number | null; statement: number },
): SourceReference => ({
  kind,
  line: location.line,
  statement: location.statement,
  channel: null,
  target: match[1] ?? null,
  detail: match[0],
});

const collectReferences = (
  text: string,
  location: { line: number | null; statement: number },
  references: SourceReference[],
): void => {
  OPEN_STATEMENT.lastIndex = 0;
  for (const match of text.matchAll(OPEN_STATEMENT))
    references.push(openReference(match, location));
  for (const match of text.matchAll(CHAIN_STATEMENT))
    references.push(simpleReference("chain", match, location));
  for (const match of text.matchAll(EXECUTE_STATEMENT))
    references.push(simpleReference("execute", match, location));
};

/**
 * Index line-numbered BR source (.brs/.wbs) or an unnumbered procedure script
 * (.prc): statement lines with byte offsets, DEF FN definitions, labels, and
 * OPEN #/CHAIN/EXECUTE target references. `text` must be latin1-decoded so
 * offsets map back to bytes.
 */
export const indexBrSource = (text: string): SourceIndex => {
  const numberedLines: SourceIndex["numbered_lines"] = [];
  const functions: SourceIndex["functions"] = [];
  const labels: SourceIndex["labels"] = [];
  const references: SourceIndex["references"] = [];
  let offset = 0;
  let statement = 0;
  let openFunction: SourceIndex["functions"][number] | undefined;

  const parts = text.split(/(\r\n|\n)/u);
  for (let index = 0; index < parts.length; index += 2) {
    const rawLine = parts[index] ?? "";
    const separator = parts[index + 1] ?? "";
    const lineText = rawLine.trimEnd();
    const numbered = lineText.match(NUMBERED_LINE);
    const line =
      numbered === null ? null : Number.parseInt(numbered[1] ?? "", 10);
    if (line !== null) numberedLines.push({ line, offset });
    const body = stripComment((numbered?.[2] ?? lineText).trim());
    if (body !== "") {
      statement += 1;
      const location = { line, statement };
      const definition = body.match(DEF_FN);
      if (definition !== null) {
        openFunction = {
          name: definition[1] ?? "",
          line,
          end_line: null,
          parameters: definition[2] ?? "",
        };
        functions.push(openFunction);
      } else if (FNEND.test(body) && openFunction !== undefined) {
        openFunction.end_line = line;
        openFunction = undefined;
      }
      const label = body.match(LABEL);
      if (label !== null && definition === null)
        labels.push({ name: label[1] ?? "", line });
      collectReferences(body, location, references);
    }
    offset += rawLine.length + separator.length;
  }

  return {
    numbered_line_count: numberedLines.length,
    numbered_lines: numberedLines,
    functions,
    labels,
    references,
  };
};
