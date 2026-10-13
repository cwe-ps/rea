import type { BusinessRulesArtifact } from "../domain/businessrules/businessRulesArtifact.js";

type ConfigIndex = Extract<
  BusinessRulesArtifact,
  { format: "br-config" }
>["config"];

const COMMENT = /^\s*(?:REM\b|!)/iu;

/**
 * Index the directive lines of a WBCONFIG.SYS runtime configuration: every
 * non-comment, non-blank line with its 1-based line number and first token.
 */
export const indexBrConfig = (text: string): ConfigIndex => {
  const directives: ConfigIndex["directives"] = [];
  for (const [index, rawLine] of text.split(/\r\n|\n/u).entries()) {
    const line = rawLine.trim();
    if (line === "" || COMMENT.test(line)) continue;
    directives.push({
      line: index + 1,
      keyword: line.split(/\s+/u)[0] ?? "",
      text: line,
    });
  }
  return { directives };
};
