import { describe, expect, it } from "vitest";

import {
  BR_SOURCE_TEXT,
  PRC_TEXT,
} from "../../tests/fixtures/businessRules/artifacts.js";
import { indexBrSource } from "./SourceIndex.js";

describe("indexBrSource", () => {
  it("indexes numbered lines, functions, labels, and references", () => {
    const index = indexBrSource(BR_SOURCE_TEXT);
    expect(index.numbered_line_count).toBe(13);
    expect(index.numbered_lines[0]).toEqual({ line: 10, offset: 0 });
    const second = index.numbered_lines[1];
    expect(second?.line).toBe(20);
    expect(second?.offset).toBe("00010 DIM MENU$(1)*80,TITLE$*80\r\n".length);
    expect(index.functions).toEqual([
      { name: "FNCOM", line: 100, end_line: 120, parameters: "(CPOS,LPOS)" },
      {
        name: "FNALT$",
        line: 130,
        end_line: 140,
        parameters: "(DUMMY$*80)",
      },
    ]);
    expect(index.labels).toEqual([{ name: "FIX_MASTER", line: 50 }]);
    expect(index.references).toEqual([
      {
        kind: "open",
        line: 30,
        statement: 3,
        channel: 1,
        target: "MASTER//6",
        detail: 'OPEN #1: "NAME=MASTER//6"',
      },
      {
        kind: "chain",
        line: 40,
        statement: 4,
        channel: null,
        target: "BEGIN/PROG1",
        detail: 'CHAIN "BEGIN/PROG1"',
      },
      {
        kind: "execute",
        line: 70,
        statement: 8,
        channel: null,
        target: "SYSTEM",
        detail: 'EXECUTE "SYSTEM"',
      },
      {
        kind: "open",
        line: 80,
        statement: 9,
        channel: 2,
        target: null,
        detail: 'OPEN #2: "NAME="',
      },
    ]);
  });

  it("indexes procedure scripts without line numbers", () => {
    const index = indexBrSource(PRC_TEXT);
    expect(index.numbered_line_count).toBe(0);
    expect(index.functions).toEqual([]);
    expect(index.labels).toEqual([]);
    expect(index.references).toEqual([
      {
        kind: "execute",
        line: null,
        statement: 2,
        channel: null,
        target: "PROC NEXT",
        detail: 'EXECUTE "PROC NEXT"',
      },
    ]);
  });

  it("ignores keywords inside trailing comments", () => {
    const index = indexBrSource('00010 LET X=1 ! CHAIN "NOPE"\r\n');
    expect(index.references).toEqual([]);
  });
});
