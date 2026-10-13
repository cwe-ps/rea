import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import {
  BR_SOURCE_TEXT,
  buildWbVariantB,
  STATUS_FILE_TEXT,
} from "../../fixtures/businessRules/artifacts.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe("inspect-business-rules-artifact CLI", () => {
  cliTest(
    "parses a compiled program, a status file, and source through the compiled CLI",
    async ({ cli }) => {
      const directory = await createTestTempDirectory("rea-br-cli-");
      const program = join(directory, "EXAMPLE.WB");
      const status = join(directory, "[WBWORK]ST-FILE.07");
      const source = join(directory, "EXAMPLE.brs");
      await writeFile(program, buildWbVariantB());
      await writeFile(status, STATUS_FILE_TEXT);
      await writeFile(source, BR_SOURCE_TEXT);
      const run = (path: string) =>
        cli.run({
          arguments: ["inspect-business-rules-artifact", path, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });

      const compiled = await run(program);
      expect(compiled.exitCode).toBe(0);
      expect(compiled.json).toMatchObject({
        normalized_result: {
          format: "br-compiled",
          program: {
            variant: "B",
            line_map: { record_count: 2, segment_count: 1 },
          },
        },
      });

      const statusResult = await run(status);
      expect(statusResult.exitCode).toBe(0);
      expect(statusResult.json).toMatchObject({
        normalized_result: {
          format: "br-status",
          status: {
            wsid: 7,
            program_id: "F:\\root\\LIBRARY\\EXAMPLE.WB",
            current_line: 120,
            last_error: 42,
          },
        },
      });

      const sourceResult = await run(source);
      expect(sourceResult.exitCode).toBe(0);
      expect(sourceResult.json).toMatchObject({
        normalized_result: {
          format: "br-source",
          source: {
            numbered_line_count: 13,
            functions: [
              { name: "FNCOM", line: 100 },
              { name: "FNALT$", line: 130 },
            ],
            labels: [{ name: "FIX_MASTER", line: 50 }],
          },
        },
      });

      const rejected = await run(join(directory, "notes.txt"));
      expect(rejected.exitCode).not.toBe(0);
    },
  );
});
