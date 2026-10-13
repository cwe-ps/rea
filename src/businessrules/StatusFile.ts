import type { BusinessRulesArtifact } from "../domain/businessrules/businessRulesArtifact.js";

type StatusFile = Extract<
  BusinessRulesArtifact,
  { format: "br-status" }
>["status"];

const WSID_LINE = /^\s*WSID=\s*(\d+)\s+Date=(\S+)\s+Time=(\S+)\s*$/u;
const PROGRAM_ID_LINE = /^Program ID\s+(\S.*)$/u;
const CURRENT_LINE = /Current Line=(\d+)/u;
const LAST_ERROR = /Last Error=(\d+)/u;
const ERROR_LINE = /Error Line=(\S+)/u;
const LAST_OS_ERROR = /^Last OS Error\s+(\d+)/u;
const PROGRAM_ROW = /^(\S.*?)\s{2,}(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+LINKS?\s*$/u;
const SERVER_FILE = /^Server File:\s*(.+?)\s*$/u;
const CONFIG_FILE = /^BR Config File:\s*(.+?)\s*$/u;
const WORKFILE_PATH = /^Workfile path:\s*(.*?)\s*$/u;
const HELP_PATH = /^Help path:\s*(.*?)\s*$/u;
const OPEN_FILE = /^Open File #\s*(\d+)\s*(:.*?)\s*$/u;
const IO_RETRIES = /^Number of I\/O retries:\s*(\d+)\s*$/u;
const DRIVE_LEADER = /^\s*[A-Z]:\s/u;

const intGroup = (match: RegExpMatchArray | null): number | null =>
  match === null ? null : Number.parseInt(match[1] ?? "", 10);

/**
 * Parse a BR status/crash file (ST-FILE). Returns null when the signature
 * lines (WSID and Program ID) are absent. Lines no rule consumes are
 * preserved verbatim in unparsed_lines.
 */
export const parseStatusFile = (text: string): StatusFile | null => {
  const lines = text.split(/\r\n|\n/u);
  const consumed = new Set<number>();
  const take = (index: number): void => {
    consumed.add(index);
  };

  let wsid: number | null = null;
  let date: string | null = null;
  let time: string | null = null;
  let programId: string | null = null;
  let currentLine: number | null = null;
  let lastError: number | null = null;
  let errorLine: string | null = null;
  let lastOsError: number | null = null;
  let serverFile: string | null = null;
  let brConfigFile: string | null = null;
  let workfilePath: string | null = null;
  let helpPath: string | null = null;
  let ioRetries: number | null = null;
  const programs: StatusFile["programs"] = [];
  const openFiles: StatusFile["open_files"] = [];
  const driveAssignments: StatusFile["drive_assignments"] = [];

  for (const [index, line] of lines.entries()) {
    const wsidMatch = line.match(WSID_LINE);
    if (wsidMatch !== null) {
      wsid = Number.parseInt(wsidMatch[1] ?? "0", 10);
      date = wsidMatch[2] ?? null;
      time = wsidMatch[3] ?? null;
      take(index);
      continue;
    }
    const programIdMatch = line.match(PROGRAM_ID_LINE);
    if (programIdMatch !== null) {
      programId = (programIdMatch[1] ?? "").trim();
      take(index);
      continue;
    }
    if (CURRENT_LINE.test(line)) {
      currentLine = intGroup(line.match(CURRENT_LINE));
      lastError = intGroup(line.match(LAST_ERROR));
      errorLine = line.match(ERROR_LINE)?.[1] ?? null;
      take(index);
      continue;
    }
    const osErrorMatch = line.match(LAST_OS_ERROR);
    if (osErrorMatch !== null) {
      lastOsError = Number.parseInt(osErrorMatch[1] ?? "", 10);
      take(index);
      continue;
    }
    const programRow = line.match(PROGRAM_ROW);
    if (programRow !== null) {
      programs.push({
        path: (programRow[1] ?? "").trim(),
        class: programRow[2] ?? "",
        state: programRow[3] ?? "",
        run_state: programRow[4] ?? "",
        links: Number.parseInt(programRow[5] ?? "0", 10),
      });
      take(index);
      continue;
    }
    const serverMatch = line.match(SERVER_FILE);
    if (serverMatch !== null) {
      serverFile = serverMatch[1] ?? null;
      take(index);
      continue;
    }
    const configMatch = line.match(CONFIG_FILE);
    if (configMatch !== null) {
      brConfigFile = configMatch[1] ?? null;
      take(index);
      continue;
    }
    const workfileMatch = line.match(WORKFILE_PATH);
    if (workfileMatch !== null) {
      workfilePath = workfileMatch[1] ?? null;
      take(index);
      continue;
    }
    const helpMatch = line.match(HELP_PATH);
    if (helpMatch !== null) {
      helpPath = helpMatch[1] ?? null;
      take(index);
      continue;
    }
    const openMatch = line.match(OPEN_FILE);
    if (openMatch !== null) {
      const following = lines[index + 1];
      const attributes =
        following !== undefined && /^\s+\S/u.test(following)
          ? following.trim()
          : null;
      if (attributes !== null) take(index + 1);
      openFiles.push({
        channel: Number.parseInt(openMatch[1] ?? "0", 10),
        name: openMatch[2] ?? "",
        attributes,
      });
      take(index);
      continue;
    }
    const retriesMatch = line.match(IO_RETRIES);
    if (retriesMatch !== null) {
      ioRetries = Number.parseInt(retriesMatch[1] ?? "0", 10);
      take(index);
      continue;
    }
  }

  // Drive assignments: fixed columns announced by their own header lines.
  const leaderIndex = lines.findIndex((line) =>
    line.startsWith("BRCONFIG Drive Assignments:"),
  );
  if (leaderIndex >= 0) {
    take(leaderIndex);
    const logicalHeader = lines[leaderIndex + 1];
    const columnHeader = lines[leaderIndex + 2];
    const underline = lines[leaderIndex + 3];
    if (logicalHeader?.startsWith("Logical Physical") === true)
      take(leaderIndex + 1);
    if (columnHeader?.startsWith("Drive") === true) take(leaderIndex + 2);
    if (/^-[\s-]*$/u.test(underline ?? "")) take(leaderIndex + 3);
    const columnOffsets =
      columnHeader === undefined
        ? undefined
        : (["Path", "Shared Name", "Directory"] as const).map((label) =>
            columnHeader.indexOf(label),
          );
    for (let index = leaderIndex + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (consumed.has(index)) {
        if (index <= leaderIndex + 3) continue;
        break;
      }
      if (!DRIVE_LEADER.test(line)) {
        if (line.trim() === "") break;
        break;
      }
      if (
        columnOffsets !== undefined &&
        columnOffsets.every((offset) => offset >= 0)
      ) {
        const [pathAt, sharedAt, directoryAt] = columnOffsets as [
          number,
          number,
          number,
        ];
        driveAssignments.push({
          logical_drive: line.slice(0, pathAt).trim(),
          physical_path: line.slice(pathAt, sharedAt).trim(),
          shared_name: line.slice(sharedAt, directoryAt).trim(),
          current_directory: line.slice(directoryAt).trim(),
        });
      } else {
        const parts = line.trim().split(/\s{2,}/u);
        driveAssignments.push({
          logical_drive: parts[0] ?? "",
          physical_path: parts[1] ?? "",
          shared_name: parts.length > 3 ? (parts[2] ?? "") : "",
          current_directory: parts.at(-1) ?? "",
        });
      }
      take(index);
    }
  }

  if (wsid === null || date === null || time === null || programId === null)
    return null;

  const unparsed = lines
    .filter((line, index) => !consumed.has(index) && line.trim() !== "")
    .map((line) => line.trim());

  return {
    wsid,
    date,
    time,
    program_id: programId,
    current_line: currentLine,
    last_error: lastError,
    error_line: errorLine,
    last_os_error: lastOsError,
    programs,
    server_file: serverFile,
    br_config_file: brConfigFile,
    workfile_path: workfilePath,
    help_path: helpPath,
    drive_assignments: driveAssignments,
    open_files: openFiles,
    io_retries: ioRetries,
    unparsed_lines: unparsed,
  };
};
