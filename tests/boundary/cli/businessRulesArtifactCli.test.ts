import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { parseBusinessRulesArtifact } from "../../../src/businessRules/BusinessRulesArtifactProvider.js";
import {
  PRC_TEXT,
  STATUS_FILE_TEXT,
} from "../../fixtures/businessRules/artifacts.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

describe("inspect-business-rules-artifact CLI", () => {
  cliTest(
    "returns the shared status and source results through the compiled CLI",
    async ({ cli }) => {
      const directory = await createTestTempDirectory("rea-br-artifact-cli-");
      const cases = [
        { path: join(directory, "ST-FILE.07"), text: STATUS_FILE_TEXT },
        { path: join(directory, "NEXT.PRC"), text: PRC_TEXT },
      ];
      for (const { path, text } of cases) {
        const bytes = Buffer.from(text, "latin1");
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
