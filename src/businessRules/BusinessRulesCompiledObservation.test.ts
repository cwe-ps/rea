import { describe, expect, it } from "vitest";
import {
  legacyObservationProgram,
  modernObservationProgram,
} from "../../tests/fixtures/businessRules/artifacts.js";
import {
  COMPILED_OBSERVATION_LIMITATIONS,
  observeBusinessRulesCompiledProgram,
} from "./BusinessRulesCompiledObservation.js";

describe("observeBusinessRulesCompiledProgram", () => {
  it("observes a legacy header, line records, and printable runs", () => {
    const program = observeBusinessRulesCompiledProgram(
      legacyObservationProgram(),
    );
    expect(program?.variant).toBe("legacy");
    const fields = new Map(
      program?.header_fields.map((entry) => [entry.name, entry]),
    );
    expect(fields.get("signature_0x08")?.value).toBe(0x0a);
    expect(fields.get("marker_0x0c")?.value).toBe(0x0118);
    expect(fields.get("word_0x14_le32")?.value).toBe(30);
    expect(fields.get("word_0x00_le32")?.meaning).toBe("unknown");
    expect(program?.line_map.records).toEqual([
      { line: 10, offset: 48, marker: 0x02 },
      { line: 20, offset: 79, marker: 0x01 },
    ]);
    expect(program?.line_map.segments).toEqual([
      { start_line: 10, end_line: 20, record_count: 2, first_offset: 48 },
    ]);
    expect(
      program?.strings.runs.some((run) => run.text === "DIM FLAG,TOTAL"),
    ).toBe(true);
    expect(
      program?.strings.runs.some((run) => run.text === '"1,1,C 8,[S]"'),
    ).toBe(true);
  });

  it("observes a modern header and splits ascending runs at a line reset", () => {
    const program = observeBusinessRulesCompiledProgram(
      modernObservationProgram(),
    );
    expect(program?.variant).toBe("modern");
    const fields = new Map(
      program?.header_fields.map((entry) => [entry.name, entry]),
    );
    expect(fields.get("signature_0x00")?.value).toBe(0x33);
    expect(fields.get("word_0x04_be32")?.value).toBeNull();
    expect(fields.get("version_0x08")?.value_hex).toBe("0c2603");
    expect(fields.get("marker_0x2e")?.value).toBe(0x0118);
    expect(program?.line_map.records.map(({ line }) => line)).toEqual([
      70, 90, 10,
    ]);
    expect(program?.line_map.segments).toEqual([
      { start_line: 70, end_line: 90, record_count: 2, first_offset: 48 },
      { start_line: 10, end_line: 10, record_count: 1, first_offset: 63 },
    ]);
  });

  it("rejects bytes without a verified variant signature", () => {
    expect(
      observeBusinessRulesCompiledProgram(
        Buffer.from("plain text, not a program"),
      ),
    ).toBeNull();
    expect(observeBusinessRulesCompiledProgram(Buffer.alloc(64))).toBeNull();
  });

  it("declares the token stream and header semantics as unknown", () => {
    expect(COMPILED_OBSERVATION_LIMITATIONS.join(" ")).toContain(
      "token stream",
    );
    expect(COMPILED_OBSERVATION_LIMITATIONS.join(" ")).toContain(
      "inspect_business_rules_program",
    );
  });
});
