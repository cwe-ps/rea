import { describe, expect, it } from "vitest";

import {
  STATUS_FILE_MINIMAL_TEXT,
  STATUS_FILE_TEXT,
} from "../../tests/fixtures/businessRules/artifacts.js";
import { parseStatusFile } from "./StatusFile.js";

describe("parseStatusFile", () => {
  it("extracts every section of a full status file", () => {
    const status = parseStatusFile(STATUS_FILE_TEXT);
    expect(status).toMatchObject({
      wsid: 7,
      date: "03/04/1992",
      time: "01:02:03",
      program_id: "F:\\root\\LIBRARY\\EXAMPLE.WB",
      current_line: 120,
      last_error: 42,
      error_line: "610:02",
      last_os_error: 5,
      server_file: "f:\\root\\wbwin\\wbserver.dat",
      br_config_file: ":F:\\ROOT\\WBWIN\\wbconfig.sys",
      workfile_path: "F:\\root\\",
      help_path: "F:\\root\\",
      io_retries: 2,
    });
    expect(status?.programs).toEqual([
      {
        path: "F:\\root\\PROG1\\MAIN.wb",
        class: "MAIN",
        state: "ACTIVE",
        run_state: "RUN",
        links: 0,
      },
      {
        path: "F:\\root\\LIBRARY\\EXAMPLE.WB",
        class: "RESIDENT",
        state: "ACTIVE",
        run_state: "END",
        links: 3,
      },
    ]);
    expect(status?.drive_assignments).toEqual([
      {
        logical_drive: "F:",
        physical_path: "F:\\",
        shared_name: "",
        current_directory: "\\root\\",
      },
      {
        logical_drive: "N:",
        physical_path: "N:\\",
        shared_name: "",
        current_directory: "\\share\\",
      },
    ]);
    expect(status?.open_files).toEqual([
      {
        channel: 0,
        name: ":CON:",
        attributes: "Window,  SROW= 1, SCOL= 1, EROW=24, ECOL=80, PARENT=#  0:",
      },
      {
        channel: 120,
        name: ":CON:",
        attributes:
          "Window, Outin,   SROW= 2, SCOL=30, EROW=11, ECOL=60, PARENT=#  0:",
      },
    ]);
    expect(status?.unparsed_lines).toEqual(["Mystery trailer line"]);
  });

  it("reports absent optional sections as null or empty", () => {
    const status = parseStatusFile(STATUS_FILE_MINIMAL_TEXT);
    expect(status).toMatchObject({
      wsid: 12,
      program_id: "F:\\root\\PROG1\\ONLY.WB",
      current_line: null,
      last_error: null,
      error_line: null,
      last_os_error: null,
      server_file: null,
      io_retries: null,
    });
    expect(status?.programs).toEqual([]);
    expect(status?.drive_assignments).toEqual([]);
    expect(status?.open_files).toEqual([]);
    expect(status?.unparsed_lines).toEqual([]);
  });

  it("rejects text without the WSID or Program ID signature", () => {
    expect(parseStatusFile("just some text\n")).toBeNull();
    expect(
      parseStatusFile("WSID= 1    Date=01/01/1990   Time=00:00:00\n"),
    ).toBeNull();
  });
});
