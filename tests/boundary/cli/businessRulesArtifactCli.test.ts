import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { parseBusinessRulesArtifact } from "../../../src/businessRules/BusinessRulesArtifactProvider.js";
import {
  CONFIG_TEXT,
  PRC_TEXT,
  SCREEN_BYTES,
  STATUS_FILE_TEXT,
} from "../../fixtures/businessRules/artifacts.js";
import { body, modernProgram } from "../../fixtures/businessRules/program.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe("inspect-business-rules-artifact CLI", () => {
  cliTest(
    "returns the shared artifact results through the compiled CLI",
    async ({ cli }) => {
      const directory = await createTestTempDirectory("rea-br-artifact-cli-");
      const cases = [
        {
          path: join(directory, "ST-FILE.07"),
          bytes: Buffer.from(STATUS_FILE_TEXT, "latin1"),
        },
        {
          path: join(directory, "NEXT.PRC"),
          bytes: Buffer.from(PRC_TEXT, "latin1"),
        },
        {
          path: join(directory, "wbconfig.sys"),
          bytes: Buffer.from(CONFIG_TEXT, "latin1"),
        },
        { path: join(directory, "SCREEN.042"), bytes: SCREEN_BYTES },
        {
          path: join(directory, "PROGRAM.WB"),
          bytes: modernProgram([{ number: 10, body: body(0x01, 0x2e) }]),
        },
      ];
      for (const { path, bytes } of cases) {
        await writeFile(path, bytes);
        const expected = parseBusinessRulesArtifact(
          path,
          bytes,
          createHash("sha256").update(bytes).digest("hex"),
        );
        if (!expected.ok) throw expected.error;
        const result = await cli.run({
          arguments: ["inspect-business-rules-artifact", path, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.json).toMatchObject({
          operation: "inspect_business_rules_artifact",
          normalized_result: expected.value,
        });
      }
      const refused = await cli.run({
        arguments: [
          "inspect-business-rules-artifact",
          join(directory, "missing.brs"),
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(refused.exitCode).not.toBe(0);
    },
  );
});
