import type { BusinessRulesStatus } from "../domain/businessRules/businessRulesArtifact.js";
import { err, ok, type Result } from "../domain/result.js";
import type { BusinessRulesFormatFailure } from "./BusinessRulesDecoder.js";

const WSID_LINE = /^\s*WSID=\s*(\d+)\s+Date=(\S+)\s+Time=(\S+)\s*$/u;
const PROGRAM_ID_LINE = /^Program ID\s+(\S.*?)\s*$/u;
const CURRENT_LINE = /Current Line=(\d+)/u;
const LAST_ERROR = /Last Error=(\d+)/u;
const ERROR_LINE = /Error Line=(\S+)/u;
const LAST_OS_ERROR = /^Last OS Error\s+(\d+)\s*$/u;
const PROGRAM_ROW = /^(\S.*?)\s{2,}(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+LINKS?\s*$/u;
const SERVER_FILE = /^Server File:\s*(.+?)\s*$/u;
const CONFIG_FILE = /^BR Config File:\s*(.+?)\s*$/u;
const WORKFILE_PATH = /^Workfile path:\s*(.*?)\s*$/u;
const HELP_PATH = /^Help path:\s*(.*?)\s*$/u;
const OPEN_FILE = /^Open File #\s*(\d+)\s*(:.*?)\s*$/u;
const IO_RETRIES = /^Number of I\/O retries:\s*(\d+)\s*$/u;
const DRIVE_SECTION = "BRCONFIG Drive Assignments:";
const DRIVE_ROW = /^\s*[A-Za-z]:\s/u;
const DRIVE_UNDERLINE = /^-[\s-]*$/u;

/** Signature lines that identify a status file from its leading text. */
export const looksLikeBusinessRulesStatus = (text: string): boolean =>
  /^\s*WSID=/u.test(text) && /^Program ID\s/mu.test(text);

const integer = (value: string | undefined): number | null =>
  value === undefined ? null : Number.parseInt(value, 10);

type DriveAssignment = BusinessRulesStatus["drive_assignments"][number];

/** Split one drive row by the column header's label positions, else by wide gaps. */
const driveRow = (
  line: string,
  header: string | undefined,
): DriveAssignment => {
  const pathAt = header?.indexOf("Path") ?? -1;
  const sharedAt = header?.indexOf("Shared Name") ?? -1;
  const directoryAt = header?.indexOf("Directory") ?? -1;
  if (pathAt > 0 && sharedAt > pathAt && directoryAt > sharedAt)
    return {
      logical_drive: line.slice(0, pathAt).trim(),
      physical_path: line.slice(pathAt, sharedAt).trim(),
      shared_name: line.slice(sharedAt, directoryAt).trim(),
      current_directory: line.slice(directoryAt).trim(),
    };
  const parts = line.trim().split(/\s{2,}/u);
  return {
    logical_drive: parts[0] ?? "",
    physical_path: parts[1] ?? "",
    shared_name: parts.length > 3 ? (parts[2] ?? "") : "",
    current_directory: parts.length > 2 ? (parts.at(-1) ?? "") : "",
  };
};

type Draft = Omit<
  BusinessRulesStatus,
  "wsid" | "date" | "time" | "program_id" | "unparsed_lines"
> & {
  signature: { wsid: number; date: string; time: string } | null;
  program_id: string | null;
};

/** One single-line field rule; the first matching rule consumes the line. */
interface LineRule {
  readonly pattern: RegExp;
  readonly apply: (match: RegExpExecArray, draft: Draft, line: string) => void;
}

const LINE_RULES: readonly LineRule[] = [
  {
    pattern: WSID_LINE,
    apply: (match, draft) => {
      draft.signature = {
        wsid: Number.parseInt(match[1] ?? "", 10),
        date: match[2] ?? "",
        time: match[3] ?? "",
      };
    },
  },
  {
    pattern: PROGRAM_ID_LINE,
    apply: (match, draft) => {
      draft.program_id = match[1] ?? null;
    },
  },
  {
    pattern: CURRENT_LINE,
    apply: (match, draft, line) => {
      draft.current_line = integer(match[1]);
      draft.last_error = integer(LAST_ERROR.exec(line)?.[1]);
      draft.error_line = ERROR_LINE.exec(line)?.[1] ?? null;
    },
  },
  {
    pattern: LAST_OS_ERROR,
    apply: (match, draft) => {
      draft.last_os_error = integer(match[1]);
    },
  },
  {
    pattern: PROGRAM_ROW,
    apply: (match, draft) => {
      draft.programs.push({
        path: (match[1] ?? "").trim(),
        class: match[2] ?? "",
        state: match[3] ?? "",
        run_state: match[4] ?? "",
        links: Number.parseInt(match[5] ?? "", 10),
      });
    },
  },
  {
    pattern: SERVER_FILE,
    apply: (match, draft) => {
      draft.server_file = match[1] ?? null;
    },
  },
  {
    pattern: CONFIG_FILE,
    apply: (match, draft) => {
      draft.br_config_file = match[1] ?? null;
    },
  },
  {
    pattern: WORKFILE_PATH,
    apply: (match, draft) => {
      draft.workfile_path = match[1] ?? null;
    },
  },
  {
    pattern: HELP_PATH,
    apply: (match, draft) => {
      draft.help_path = match[1] ?? null;
    },
  },
  {
    pattern: IO_RETRIES,
    apply: (match, draft) => {
      draft.io_retries = integer(match[1]);
    },
  },
];

const isDriveHeader = (line: string): boolean =>
  line.startsWith("Logical") ||
  line.startsWith("Drive") ||
  DRIVE_UNDERLINE.test(line);

/**
 * Consume a drive-assignment section: up to three column-header lines, then
 * one row per drive. Returns the index of the last consumed line.
 */
const readDriveSection = (
  lines: readonly string[],
  start: number,
  draft: Draft,
  consumed: Set<number>,
): number => {
  consumed.add(start);
  let columns: string | undefined;
  let cursor = start + 1;
  while (cursor < lines.length && isDriveHeader(lines[cursor] ?? "")) {
    if ((lines[cursor] ?? "").startsWith("Drive")) columns = lines[cursor];
    consumed.add(cursor);
    cursor += 1;
  }
  while (cursor < lines.length && DRIVE_ROW.test(lines[cursor] ?? "")) {
    draft.drive_assignments.push(driveRow(lines[cursor] ?? "", columns));
    consumed.add(cursor);
    cursor += 1;
  }
  return cursor - 1;
};

/** Consume one open-channel line and its indented attribute line, when present. */
const readOpenFile = (
  lines: readonly string[],
  start: number,
  draft: Draft,
  consumed: Set<number>,
): number => {
  const match = OPEN_FILE.exec(lines[start] ?? "");
  if (match === null) return start;
  const following = lines[start + 1];
  const attributes =
    following !== undefined && /^\s+\S/u.test(following)
      ? following.trim()
      : null;
  draft.open_files.push({
    channel: Number.parseInt(match[1] ?? "", 10),
    name: match[2] ?? "",
    attributes,
  });
  consumed.add(start);
  if (attributes === null) return start;
  consumed.add(start + 1);
  return start + 1;
};

/**
 * Parse a BR runtime status/crash file (ST-FILE). The WSID and Program ID
 * signature lines are required; every other section is optional, and lines no
 * rule consumes are preserved verbatim in `unparsed_lines`.
 */
export const parseBusinessRulesStatus = (
  text: string,
): Result<BusinessRulesStatus, BusinessRulesFormatFailure> => {
  const lines = text.split(/\r\n|\n|\r/u);
  const consumed = new Set<number>();
  const draft: Draft = {
    signature: null,
    program_id: null,
    current_line: null,
    last_error: null,
    error_line: null,
    last_os_error: null,
    programs: [],
    server_file: null,
    br_config_file: null,
    workfile_path: null,
    help_path: null,
    drive_assignments: [],
    open_files: [],
    io_retries: null,
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (OPEN_FILE.test(line)) {
      index = readOpenFile(lines, index, draft, consumed);
      continue;
    }
    if (line.startsWith(DRIVE_SECTION)) {
      index = readDriveSection(lines, index, draft, consumed);
      continue;
    }
    for (const rule of LINE_RULES) {
      const match = rule.pattern.exec(line);
      if (match === null) continue;
      rule.apply(match, draft, line);
      consumed.add(index);
      break;
    }
  }
  const { signature, program_id: programId, ...fields } = draft;
  if (signature === null || programId === null || programId === "")
    return err({
      _tag: "BusinessRulesFormatFailure",
      kind: "malformed",
      message:
        "Status file is missing its WSID/Date/Time or Program ID signature line.",
    });
  return ok({
    ...signature,
    program_id: programId,
    ...fields,
    unparsed_lines: lines.flatMap((text, index) =>
      consumed.has(index) || text.trim() === ""
        ? []
        : [{ line: index + 1, text }],
    ),
  });
};
