import { describe, expect, it } from "vitest";
import {
  body,
  float64,
  legacyProgram,
  operands,
  run,
  strippedProgram,
  symbol,
  u32,
} from "../../tests/fixtures/businessRules/program.js";
import type { BusinessRulesProgram } from "../domain/businessRules/businessRulesProgram.js";
import { decodeBusinessRulesProgram } from "./BusinessRulesProgramProvider.js";

const PATH = "/programs/STRIPPED.br";
const SHA = "0".repeat(64);

const decode = (data: Buffer): BusinessRulesProgram => {
  const result = decodeBusinessRulesProgram(PATH, data, SHA);
  if (!result.ok) throw result.error;
  return result.value.program;
};

const code = (...parts: readonly (number | Buffer)[]): Buffer =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === "number" ? Buffer.from([part]) : part,
    ),
  );

// Symbol slots; a zero byte is a freed slot that still takes an index.
const X = 0x100;
const A = 0x102;
const NAME = 0x103;
const ONE = 0x104;
const HALF = 0x105;
const MENU = 0x106;
const C = 0x107;
const symbols = Buffer.concat([
  symbol("X", 0x0000),
  Buffer.from([0]),
  symbol("A", 0x0000),
  symbol("CUSTOMER_NAME$", 0x4000, Buffer.alloc(0), { width: 30 }),
  symbol("", 0x2040, float64(1)),
  symbol("", 0x2040, float64(0.5)),
  symbol("", 0x6040, Buffer.concat([u32(4), Buffer.from("MENU")])),
  symbol("C", 0x0000),
]);

/** Program order with line 10 stored at table position 3. */
const SLOTS = [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11];

const program = strippedProgram(
  [
    // LET X=(A+.5)*C: operands pushed, `+` then push C, `*`, `:=`, LET.
    {
      number: 10,
      code: code(3, operands(X, A, HALF), 0x8b, operands(C), 0x08, 0x0d, 0x41),
    },
    // IF A=1 THEN (jump operand is the END IF position).
    {
      number: 20,
      code: code(2, operands(A, ONE), 0x16, 0x00, 0xa8, operands(2)),
    },
    // PRINT CUSTOMER_NAME$;X, : separator runs `(type << 3) | count`, final 0x20.
    {
      number: 30,
      code: code(2, operands(NAME, X), 0x00, 0x18, 0x14, 0x11, 0x29, 0x6f),
    },
    { number: 40, code: code(0x00, 0x2f, 0x68) },
    // GOTO operand 3 is a line-table position, which holds line 10.
    { number: 50, code: code(0x00, 0xac, operands(3), 0x6f) },
    { number: 60, code: code(1, operands(MENU), 0x00, 0x71) },
    // DIM keeps its source record after `00 4b 40`, even when stripped.
    {
      number: 70,
      code: code(0x00, 0x4b, 0x40),
      record: body(0x01, 0x0b, run(5, "LIST$(5)*20")),
    },
    // Opcode 0x06 is not a known expression op.
    { number: 80, code: code(1, operands(A), 0x06, 0x0d, 0x41) },
    // A group count overrunning the code is undecodable.
    { number: 90, code: code(0x05) },
    // FORM compiled inline: POS 5, C 10, N 5.2.
    {
      number: 100,
      code: code(0x00, 0x5e, 0x40, 0x81, 5, 0x49, 10, 0, 0x51, 5, 2, 0),
    },
    // A comment-only line compiles to a bare separator.
    { number: 110, code: code(0x40) },
    { number: 120, code: code(0x00, 0x6f) },
  ],
  { symbols, symbolSlots: 8, slots: SLOTS },
);

describe("Business Rules! execution-stream decoding", () => {
  it("decompiles stripped programs in program order with resolved operands and jumps", () => {
    const decoded = decode(program);
    expect(decoded.listing).toMatchObject({
      status: "decoded",
      basis: "execution-stream",
      reason: null,
      unresolved_keywords: [],
    });
    expect(
      decoded.listing.lines.map(({ number, text }) => [number, text]),
    ).toEqual([
      [10, "let X=(A+.5)*C"],
      [20, "if A=1 then"],
      [30, "  print Customer_Name$;X,"],
      [40, "end if"],
      [50, "goto 10"],
      [60, 'chain "MENU"'],
      [70, "dim List$(5)*20"],
      [80, "let A=<?X06/0>"],
      [90, "! <Undecodable: Parseerror> 05"],
      [100, "form pos 5,C 10,N 5.2"],
      [110, "!"],
      [120, "end"],
    ]);
  });

  it("surfaces unknown opcodes and undecodable lines as explicit markers", () => {
    expect(decode(program).listing.unknown_markers).toEqual([
      { line: 80, marker: "<?X06/0>" },
      { line: 90, marker: "<undecodable: ParseError>" },
    ]);
  });

  it("locates code and embedded records and derives references from statements", () => {
    const decoded = decode(program);
    const [first] = decoded.listing.lines;
    expect(first?.embedded).toBe(false);
    // The line's code follows its one-byte length.
    expect(program[(first?.record_offset ?? 0) - 1]).toBe(13);
    const dim = decoded.listing.lines.find((line) => line.number === 70);
    expect(dim?.embedded).toBe(true);
    expect(
      program
        .subarray((dim?.record_offset ?? 0) + 1, (dim?.record_offset ?? 0) + 6)
        .toString(),
    ).toBe("00070");
    expect(decoded.references).toMatchObject({
      status: "derived",
      programs_chained: [{ line: 60, expression: '"MENU"', literal: "MENU" }],
    });
    expect(decoded.limitations.join("\n")).toMatch(
      /Comments, REM text and labels/u,
    );
    expect(decoded.string_constants.values).toEqual([
      { symbol_index: 6, value: "MENU" },
    ]);
  });

  it("reports why a stripped program cannot be decompiled", () => {
    const damaged = decode(
      strippedProgram([{ number: 10, code: code(0x00, 0x6f) }], {
        symbols: Buffer.from([0x07]),
        symbolSlots: 1,
      }),
    );
    expect(damaged.listing).toMatchObject({
      status: "malformed",
      basis: null,
      lines: [],
      unknown_markers: [],
    });
    expect(damaged.listing.reason).toMatch(/symbol table/u);
    expect(damaged.references.status).toBe("unknown");

    const legacy = legacyProgram(10, body(0x01, 0x2e));
    const savedSize = legacy.readUInt32LE(4);
    const strippedLegacy = Buffer.from(
      legacy.subarray(0, legacy.length - savedSize),
    );
    strippedLegacy.writeUInt32LE(0, 4);
    const unsupported = decode(strippedLegacy);
    expect(unsupported.listing).toMatchObject({
      status: "absent",
      basis: null,
    });
    expect(unsupported.listing.reason).toMatch(/modern layout/u);
  });

  it("rejects a code pointer outside the execution section as malformed", () => {
    const data = Buffer.from(
      strippedProgram([{ number: 10, code: code(0x00, 0x6f) }]),
    );
    data.writeUInt32BE(0xffff, data.readUInt32BE(22) + 4);
    expect(decode(data).listing).toMatchObject({
      status: "malformed",
      lines: [],
    });
  });
});
