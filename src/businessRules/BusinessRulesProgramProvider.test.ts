import { describe, expect, it } from "vitest";
import {
  body,
  float64,
  legacyProgram,
  legacyStrippedProgram,
  modernProgram,
  run,
  stripListing,
  symbol,
  u32,
} from "../../tests/fixtures/businessRules/program.js";
import type { BusinessRulesProgram } from "../domain/businessRules/businessRulesProgram.js";
import { decodeBusinessRulesProgram } from "./BusinessRulesProgramProvider.js";

const PATH = "/programs/FIXTURE.WB";
const SHA = "0".repeat(64);

const decode = (data: Buffer): BusinessRulesProgram => {
  const result = decodeBusinessRulesProgram(PATH, data, SHA);
  if (!result.ok) throw result.error;
  return result.value.program;
};

const listing = (data: Buffer): string[] =>
  decode(data).listing.lines.map(
    (line) => `${String(line.number).padStart(5, "0")} ${line.text}`,
  );

const failure = (data: Buffer) => {
  const result = decodeBusinessRulesProgram(PATH, data, SHA);
  if (result.ok) throw new Error("expected a decoder refusal");
  return result.error;
};

describe("Business Rules! saved-LIST decoding", () => {
  it("follows the line table through embedded DIM and listed records", () => {
    const program = decode(
      modernProgram([
        { number: 20, body: body(0x01, 0x18, run(5, "A$")) },
        { number: 10, body: body(0x01, 0x0b, run(5, "A$*80")), embedded: true },
      ]),
    );
    expect(program.header).toMatchObject({
      variant: "modern",
      header_bytes: 51,
      byteorder: "big",
      version_bytes: "0c260380",
      option_bytes: "0118000001",
    });
    expect(program.listing).toMatchObject({
      status: "decoded",
      basis: "saved-list",
      unresolved_keywords: [],
    });
    expect(
      program.listing.lines.map(({ number, text, embedded }) => ({
        number,
        text,
        embedded,
      })),
    ).toEqual([
      { number: 10, text: "DIM A$*80", embedded: true },
      { number: 20, text: "PRINT A$", embedded: false },
    ]);
  });

  it("reads legacy little-endian containers and historical clause codes", () => {
    const content = body(0x01, 0x29, 0x02, 0x28, 0x01, 0x2c, run(3, "9000"));
    const program = decode(legacyProgram(10, content));
    expect(program.header).toMatchObject({
      variant: "legacy",
      byteorder: "little",
      header_bytes: 30,
      legacy_clause_codes: true,
    });
    expect(listing(legacyProgram(10, content))).toEqual([
      "00010 ON ERROR GOTO 9000",
    ]);
    expect(program.symbols.status).toBe("unsupported");
    expect(program.string_constants.status).toBe("unsupported");
  });

  it("ignores slots unreachable from the first active slot", () => {
    const data = modernProgram([
      { number: 10, body: body(0x01, 0x2e) },
      { number: 20, body: body(0x01, 0x04) },
    ]);
    const tableStart = data.readUInt32BE(22);
    data.writeUInt16BE(1, 12);
    data.fill(0xff, tableStart, tableStart + 14);
    expect(listing(data)).toEqual(["00020 PAUSE"]);
  });

  it("stops at a NUL inside a nominal text run and keeps punctuation", () => {
    expect(
      listing(
        modernProgram([
          {
            number: 10,
            body: body(0x01, 0x00, 0x06, 0x09, "! Hi", 0, "JUNK"),
          },
          {
            number: 20,
            body: body(
              0x01,
              0x14,
              "#",
              run(5, "2"),
              ",",
              0x02,
              0x34,
              run(5, "1"),
              ": ",
              0x05,
              0x02,
              "A$",
              0,
              "stale",
            ),
          },
          {
            number: 30,
            body: body(0x01, 0x04, " ", run(6, "!:\n"), " ", 0x01, 0x2e),
          },
        ]),
      ),
    ).toEqual([
      "00010 ! Hi",
      "00020 READ #2,REC=1: A$",
      "00030 PAUSE  !:\n STOP",
    ]);
  });

  it("keeps unknown keywords visible and reports them", () => {
    const program = decode(
      modernProgram([{ number: 10, body: body(0x01, 0x03, run(6, "ABC")) }]),
    );
    expect(program.listing.lines[0]?.text).toBe("[[01:03]] ABC");
    expect(program.listing.unresolved_keywords).toEqual([
      { group: "statement", code: 3 },
    ]);
  });
});

// Shared fixture: symbols, OPEN/LIBRARY/DEF/CHAIN records and a saved LIST.
const symbols = Buffer.concat([
  symbol("", 0x2040, float64(93)),
  symbol("MAT A", 0x005a, u32(3, 4), { tag: 1 }),
  symbol("", 0x6040, Buffer.concat([u32(2), Buffer.from("hi")]), {
    width: 2,
  }),
  Buffer.from([0]),
  symbol("FNX$", 0xc048),
]);
const data = modernProgram(
  [
    {
      number: 10,
      body: body(
        0x01,
        0x12,
        "#",
        run(5, "1"),
        ": ",
        run(5, '"NAME=DATA/CUST.DAT,SHR"'),
        ",",
        0x02,
        0x19,
        ",",
        0x02,
        0x1a,
      ),
    },
    {
      number: 20,
      body: body(
        0x01,
        0x0d,
        run(5, '"LIB/UTIL"'),
        ": ",
        run(5, "FNA,FNB$"),
        " ",
        run(6, "! helpers"),
      ),
    },
    { number: 30, body: body(0x01, 0x26, 0x02, 0x6f, run(5, "FNX$(A$)")) },
    { number: 40, body: body(0x01, 0x31, run(5, '"MENU"')) },
    {
      number: 50,
      body: body(0x01, 0x12, "#", run(5, "H:=FNH"), ": ", run(5, "F$")),
    },
    { number: 60, body: body(0x01, 0x36, run(5, '"PROC NEXT"')) },
  ],
  { symbols, symbolSlots: 5 },
);

describe("Business Rules! symbols and references", () => {
  it("classifies modern symbols, dimensions and constants", () => {
    const program = decode(data);
    expect(program.symbols.status).toBe("decoded");
    expect(
      program.symbols.entries.map(
        ({ index, name, kind, dimensions, numeric_value, name_tag }) => ({
          index,
          name,
          kind,
          dimensions,
          numeric_value,
          name_tag,
        }),
      ),
    ).toEqual([
      {
        index: 0,
        name: null,
        kind: "numeric-constant",
        dimensions: null,
        numeric_value: 93,
        name_tag: 0,
      },
      {
        index: 1,
        name: "MAT A",
        kind: "array",
        dimensions: [3, 4],
        numeric_value: null,
        name_tag: 1,
      },
      {
        index: 2,
        name: null,
        kind: "string-constant",
        dimensions: null,
        numeric_value: null,
        name_tag: 0,
      },
      {
        index: 4,
        name: "FNX$",
        kind: "function",
        dimensions: null,
        numeric_value: null,
        name_tag: 0,
      },
    ]);
    expect(program.string_constants.values).toEqual([
      { symbol_index: 2, value: "hi" },
    ]);
  });

  it("derives OPEN, LIBRARY, DEF, CHAIN and EXECUTE references from the listing", () => {
    expect(decode(data).references).toEqual({
      evidence_kind: "derived",
      status: "derived",
      files_opened: [
        {
          line: 10,
          channel: "1",
          expression: '"NAME=DATA/CUST.DAT,SHR"',
          literal: "NAME=DATA/CUST.DAT,SHR",
          name: "DATA/CUST.DAT",
        },
        {
          line: 50,
          channel: "H:=FNH",
          expression: "F$",
          literal: null,
          name: null,
        },
      ],
      programs_chained: [{ line: 40, expression: '"MENU"', literal: "MENU" }],
      commands_executed: [
        { line: 60, expression: '"PROC NEXT"', literal: "PROC NEXT" },
      ],
      libraries: [
        {
          line: 20,
          expression: '"LIB/UTIL"',
          literal: "LIB/UTIL",
          functions: ["FNA", "FNB$"],
        },
      ],
      functions_defined: [{ line: 30, name: "FNX$", library: true }],
    });
  });
});

describe("Business Rules! stripped programs", () => {
  it("prefers the saved LIST and decodes the execution stream once it is removed", () => {
    expect(decode(data).listing.basis).toBe("saved-list");
    const program = decode(stripListing(data));
    // The fixture's execution code is a bare separator per line.
    expect(program.listing).toMatchObject({
      status: "decoded",
      basis: "execution-stream",
      unknown_markers: [],
    });
    expect(
      program.listing.lines.map(({ number, text }) => [number, text]),
    ).toEqual([
      [10, "!"],
      [20, "!"],
      [30, "!"],
      [40, "!"],
      [50, "!"],
      [60, "!"],
    ]);
    expect(program.references).toMatchObject({
      status: "derived",
      files_opened: [],
    });
    expect(program.symbols.entries).toHaveLength(4);
    expect(program.string_constants.values).toEqual([
      { symbol_index: 2, value: "hi" },
    ]);
    expect(program.header.sections.listing.bytes).toBe(0);
  });
});

describe("Business Rules! stripped legacy programs", () => {
  const dim = body(0x01, 0x0b, run(5, "A$*20,B(3)"));
  const symbolSection = Buffer.concat([
    Buffer.from("CUSTNAME$", "latin1"),
    Buffer.from([0x00, 0x09, 0x00]),
    Buffer.from("X", "latin1"),
    Buffer.from([0x00, 0x01]),
  ]);
  const data = legacyStrippedProgram(
    [{ number: 5 }, { number: 10, embedded: dim }, { number: 20 }],
    symbolSection,
  );

  it("reports the observed line table, embedded DIM text and symbol-section strings", () => {
    const program = decode(data);
    expect(program.listing).toMatchObject({ status: "absent", lines: [] });
    expect(program.references.status).toBe("unknown");
    expect(program.symbols.status).toBe("unsupported");
    const facts = program.stripped_legacy;
    expect(facts?.line_table.status).toBe("decoded");
    expect(
      facts?.line_table.lines.map(({ number, flags, embedded, text }) => ({
        number,
        flags,
        embedded,
        text,
      })),
    ).toEqual([
      { number: 5, flags: 0x08, embedded: false, text: null },
      { number: 10, flags: 0x8a, embedded: true, text: "DIM A$*20,B(3)" },
      { number: 20, flags: 0x08, embedded: false, text: null },
    ]);
    const embedded = facts?.line_table.lines[1];
    expect(embedded?.record_offset).toBe(
      data.indexOf(Buffer.from("\x0100010", "latin1")),
    );
    expect(facts?.symbol_section_strings).toEqual([
      { offset: data.indexOf(Buffer.from("CUSTNAME$")), text: "CUSTNAME$" },
    ]);
    expect(program.limitations.join(" ")).toContain("stripped_legacy");
  });

  it("keeps header facts when the legacy line-table chain is damaged", () => {
    const damaged = Buffer.from(data);
    damaged.writeUInt16LE(7, 28);
    const program = decode(damaged);
    expect(program.stripped_legacy?.line_table).toEqual({
      status: "malformed",
      reason: "Invalid line-table chain.",
      lines: [],
    });
    expect(program.stripped_legacy?.symbol_section_strings).toHaveLength(1);
  });

  it("omits the fallback facet for programs that keep a saved LIST or use the modern layout", () => {
    expect(
      decode(legacyProgram(10, body(0x01, 0x2e))).stripped_legacy,
    ).toBeNull();
    expect(
      decode(
        stripListing(modernProgram([{ number: 10, body: body(0x01, 0x2e) }])),
      ).stripped_legacy,
    ).toBeNull();
  });
});

describe("Business Rules! malformed input", () => {
  const valid = modernProgram([{ number: 10, body: body(0x01, 0x2e) }]);

  it("refuses unrecognized files as unsupported targets", () => {
    expect(failure(Buffer.alloc(10))._tag).toBe(
      "AnalysisUnsupportedTargetError",
    );
    expect(failure(Buffer.alloc(64, 0x41))._tag).toBe(
      "AnalysisUnsupportedTargetError",
    );
  });

  it("rejects inconsistent section layouts as invalid input", () => {
    const data = Buffer.from(valid);
    data.writeUInt32BE(data.readUInt32BE(4) + 1, 4);
    expect(failure(data)._tag).toBe("AnalysisInputError");
    expect(failure(valid.subarray(0, 40))._tag).toBe("AnalysisInputError");
  });

  it("reports cyclic chains and out-of-section pointers as a malformed listing", () => {
    const tableStart = valid.readUInt32BE(22);
    for (const [offset, field] of [
      [12, Buffer.from([0, 0])],
      [8, Buffer.alloc(4, 0xff)],
    ] as const) {
      const data = Buffer.from(valid);
      field.copy(data, tableStart + offset);
      const program = decode(data);
      expect(program.listing).toMatchObject({
        status: "malformed",
        lines: [],
      });
      expect(program.references.status).toBe("unknown");
    }
  });

  it("rejects truncated text and unknown token groups", () => {
    expect(
      decode(
        modernProgram([
          { number: 10, body: body(0x05, 0x10, "short"), unterminated: true },
        ]),
      ).listing.status,
    ).toBe("malformed");
    expect(
      decode(
        modernProgram([
          { number: 10, body: body(0x01, 0x2e), unterminated: true },
        ]),
      ).listing.reason,
    ).toMatch(/Unterminated/u);
    expect(
      decode(modernProgram([{ number: 10, body: body(0x08, 0x01) }])).listing
        .status,
    ).toBe("unsupported");
  });

  it("reports a damaged symbol table without discarding the listing", () => {
    const data = modernProgram([{ number: 10, body: body(0x01, 0x2e) }], {
      symbols: Buffer.from([0x07]),
      symbolSlots: 1,
    });
    const program = decode(data);
    expect(program.listing.status).toBe("decoded");
    expect(program.symbols).toMatchObject({ status: "malformed", entries: [] });
  });
});
