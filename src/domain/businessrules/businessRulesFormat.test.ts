import { describe, expect, it } from "vitest";

import {
  buildWbVariantA,
  buildWbVariantB,
  STATUS_FILE_TEXT,
} from "../../../tests/fixtures/businessRules/artifacts.js";
import {
  businessRulesClassificationBasis,
  classifyBusinessRulesPath,
  confirmBusinessRulesFormat,
  sniffBusinessRulesContent,
  sniffWbVariant,
} from "./businessRulesFormat.js";

describe("classifyBusinessRulesPath", () => {
  it.each([
    ["LIBRARY/ONQUTIL.WB", "br-compiled"],
    ["prog1/begin.wb", "br-compiled"],
    ["SOURCE/UPGRADE.WBS", "br-source"],
    ["FIXPROG/2D.brs", "br-source"],
    ["SCRIPT/A11.PRC", "br-procedure"],
    ["[WBWORK]ST-FILE.01", "br-status"],
    ["ST-FILE.325", "br-status"],
    ["SCREEN/SCREEN.6", "br-screen"],
    ["WBWIN/WBConfig.Sys", "br-config"],
  ] as const)("classifies %s as %s", (path, format) => {
    expect(classifyBusinessRulesPath(path)).toBe(format);
  });

  it.each([
    "readme.txt",
    "ST-FILES.01",
    "screen.six",
    "wbconfig.bak",
    "program.wbx",
  ])("leaves %s unclassified", (path) => {
    expect(classifyBusinessRulesPath(path)).toBeUndefined();
  });
});

describe("sniffWbVariant", () => {
  it("detects both header variants", () => {
    expect(sniffWbVariant(buildWbVariantA())).toBe("A");
    expect(sniffWbVariant(buildWbVariantB())).toBe("B");
  });

  it("rejects near misses", () => {
    const broken = buildWbVariantB();
    broken[20] = 0xff;
    expect(sniffWbVariant(broken)).toBeUndefined();
    expect(sniffWbVariant(Buffer.from("00000 plain"))).toBeUndefined();
    expect(sniffWbVariant(Buffer.alloc(8))).toBeUndefined();
  });
});

describe("sniffBusinessRulesContent", () => {
  it("detects compiled programs and status files from bytes alone", () => {
    expect(sniffBusinessRulesContent(buildWbVariantA())).toBe("br-compiled");
    expect(sniffBusinessRulesContent(Buffer.from(STATUS_FILE_TEXT))).toBe(
      "br-status",
    );
    expect(
      sniffBusinessRulesContent(Buffer.from("hello world")),
    ).toBeUndefined();
  });
});

describe("confirmBusinessRulesFormat", () => {
  it("demotes plaintext saved under a compiled-program name to source", () => {
    expect(
      confirmBusinessRulesFormat("br-compiled", Buffer.from("02500 PRINT\r\n")),
    ).toBe("br-source");
    expect(confirmBusinessRulesFormat("br-compiled", buildWbVariantB())).toBe(
      "br-compiled",
    );
  });

  it("requires WSID and Program ID markers for status files", () => {
    expect(
      confirmBusinessRulesFormat("br-status", Buffer.from(STATUS_FILE_TEXT)),
    ).toBe("br-status");
    expect(confirmBusinessRulesFormat("br-status", Buffer.from("nope"))).toBe(
      "file",
    );
  });

  it("drops non-text content for text formats", () => {
    expect(
      confirmBusinessRulesFormat("br-source", Buffer.from([0x00, 0x01, 0x02])),
    ).toBe("file");
  });

  it("keeps screen records extension-only", () => {
    expect(
      confirmBusinessRulesFormat("br-screen", Buffer.from([0x01, 0x00])),
    ).toBe("br-screen");
    expect(businessRulesClassificationBasis("br-screen")).toBe(
      "extension-only",
    );
  });
});
