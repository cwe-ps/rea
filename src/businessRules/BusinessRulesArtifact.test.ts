import { describe, expect, it } from "vitest";
import {
  BR_SOURCE_TEXT,
  PRC_TEXT,
  STATUS_FILE_MINIMAL_TEXT,
  STATUS_FILE_TEXT,
} from "../../tests/fixtures/businessRules/artifacts.js";
import {
  body,
  legacyProgram,
  modernProgram,
} from "../../tests/fixtures/businessRules/program.js";
import { AnalysisUnsupportedTargetError } from "../domain/analysisErrorCore.js";
import type { BusinessRulesArtifact } from "../domain/businessRules/businessRulesArtifact.js";
import { parseBusinessRulesArtifact } from "./BusinessRulesArtifactProvider.js";

const SHA = "0".repeat(64);

const parse = (path: string, text: string | Buffer): BusinessRulesArtifact => {
  const result = parseBusinessRulesArtifact(
    path,
    typeof text === "string" ? Buffer.from(text, "latin1") : text,
    SHA,
  );
  if (!result.ok) throw result.error;
  return result.value;
};

const refusal = (path: string, data: Buffer) => {
  const result = parseBusinessRulesArtifact(path, data, SHA);
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
};

describe("Business Rules! status files", () => {
  it("reads every printed section and keeps unrecognized lines verbatim", () => {
    const artifact = parse("/runtime/[WBWORK]ST-FILE.07", STATUS_FILE_TEXT);
    if (artifact.format !== "status-file") throw new Error(artifact.format);
    expect(artifact.classification.basis).toBe("content-signature");
    expect(artifact.status).toEqual({
      wsid: 7,
      date: "03/04/1992",
      time: "01:02:03",
      program_id: "F:\\root\\LIBRARY\\EXAMPLE.WB",
      current_line: 120,
      last_error: 42,
      error_line: "610:02",
      last_os_error: 5,
      programs: [
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
      ],
      server_file: "f:\\root\\wbwin\\wbserver.dat",
      br_config_file: ":F:\\ROOT\\WBWIN\\wbconfig.sys",
      workfile_path: "F:\\root\\",
      help_path: "F:\\root\\",
      drive_assignments: [
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
      ],
      open_files: [
        {
          channel: 0,
          name: ":CON:",
          attributes:
            "Window,  SROW= 1, SCOL= 1, EROW=24, ECOL=80, PARENT=#  0:",
        },
        {
          channel: 120,
          name: ":CON:",
          attributes:
            "Window, Outin,   SROW= 2, SCOL=30, EROW=11, ECOL=60, PARENT=#  0:",
        },
      ],
      io_retries: 2,
      unparsed_lines: [
        {
          line:
            STATUS_FILE_TEXT.split("\r\n").indexOf("Mystery trailer line") + 1,
          text: "Mystery trailer line",
        },
      ],
    });
  });

  it("reports absent optional sections as null or empty, regardless of name", () => {
    const artifact = parse("/runtime/crash.txt", STATUS_FILE_MINIMAL_TEXT);
    if (artifact.format !== "status-file") throw new Error(artifact.format);
    expect(artifact.status).toMatchObject({
      wsid: 12,
      program_id: "F:\\root\\PROG1\\ONLY.WB",
      current_line: null,
      last_error: null,
      error_line: null,
      last_os_error: null,
      server_file: null,
      io_retries: null,
      programs: [],
      drive_assignments: [],
      open_files: [],
      unparsed_lines: [],
    });
  });

  it("rejects a status signature without its WSID/Date/Time line as invalid input", () => {
    const error = refusal(
      "/runtime/ST-FILE.01",
      Buffer.from("WSID=?\nProgram ID F:\\X.WB\n", "latin1"),
    );
    expect(error._tag).toBe("AnalysisInputError");
  });
});

describe("Business Rules! source text", () => {
  it("indexes numbered lines, labels and references with the compiled-listing projection", () => {
    const artifact = parse("/source/EXAMPLE.brs", BR_SOURCE_TEXT);
    if (artifact.format !== "source-text") throw new Error(artifact.format);
    expect(artifact.classification.basis).toBe("extension-and-content");
    const { source } = artifact;
    expect(source.numbering).toBe("numbered");
    expect(source.physical_lines).toBe(15);
    expect(source.lines.map(({ number }) => number)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140,
    ]);
    expect(source.lines[1]).toEqual({
      number: 20,
      physical_line: 2,
      offset: "00010 DIM MENU$(1)*80,TITLE$*80\r\n".length,
    });
    expect(source.lines[6]).toMatchObject({ number: 70, physical_line: 8 });
    expect(source.labels).toEqual([
      { name: "FIX_MASTER", line: 50, physical_line: 5 },
    ]);
    expect(source.references).toEqual({
      evidence_kind: "derived",
      files_opened: [
        {
          line: 30,
          physical_line: 3,
          channel: "1",
          expression: '"NAME=MASTER//6"',
          literal: "NAME=MASTER//6",
          name: "MASTER//6",
        },
        {
          line: 80,
          physical_line: 9,
          channel: "2",
          expression: '"NAME="&TRIM$(FILENAME$)&",SHR"',
          literal: null,
          name: null,
        },
      ],
      programs_chained: [
        {
          line: 40,
          physical_line: 4,
          expression: '"BEGIN/PROG1"',
          literal: "BEGIN/PROG1",
        },
        {
          line: 60,
          physical_line: 6,
          expression: '"AFTER"',
          literal: "AFTER",
        },
      ],
      commands_executed: [
        {
          line: 70,
          physical_line: 8,
          expression: '"SYSTEM"',
          literal: "SYSTEM",
        },
      ],
      libraries: [
        {
          line: 140,
          physical_line: 15,
          expression: '"LIB/UTIL"',
          literal: "LIB/UTIL",
          functions: ["fnHelp"],
        },
      ],
      functions_defined: [
        { line: 100, physical_line: 11, name: "FNCOM", library: false },
        { line: 130, physical_line: 14, name: "FNALT$", library: true },
      ],
    });
  });

  it("indexes unnumbered procedure scripts", () => {
    const artifact = parse("/source/NEXT.PRC", PRC_TEXT);
    if (artifact.format !== "source-text") throw new Error(artifact.format);
    expect(artifact.source).toMatchObject({
      numbering: "unnumbered",
      physical_lines: 5,
      lines: [],
      labels: [],
    });
    expect(artifact.source.references.commands_executed).toEqual([
      {
        line: null,
        physical_line: 4,
        expression: '"PROC NEXT"',
        literal: "PROC NEXT",
      },
    ]);
  });

  it("recognizes numbered BR text by content and text saved under a program name", () => {
    expect(
      parse("/source/listing.txt", BR_SOURCE_TEXT).classification.basis,
    ).toBe("content-signature");
    expect(parse("/programs/SAVED.WB", BR_SOURCE_TEXT).format).toBe(
      "source-text",
    );
  });
});

describe("Business Rules! artifact refusals", () => {
  it("points compiled programs, including damaged ones, to the program decoder", () => {
    const program = modernProgram([{ number: 10, body: body(0x01, 0x2e) }]);
    const damaged = Buffer.from(program);
    damaged.writeUInt32BE(0xffff, 4);
    for (const data of [
      program,
      legacyProgram(10, body(0x01, 0x2e)),
      damaged,
    ]) {
      const error = refusal("/programs/X.WB", data);
      expect(error).toBeInstanceOf(AnalysisUnsupportedTargetError);
      if (!(error instanceof AnalysisUnsupportedTargetError)) return;
      expect(error.remediationAction).toMatch(
        /inspect_business_rules_program/u,
      );
    }
  });

  it("refuses binary content and unrelated text as unsupported targets", () => {
    for (const data of [
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3]),
      Buffer.from("plain notes, no BR statements\n", "latin1"),
      Buffer.alloc(0),
    ])
      expect(refusal("/data/notes.txt", data)._tag).toBe(
        "AnalysisUnsupportedTargetError",
      );
  });
});
