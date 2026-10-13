import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BR_SOURCE_TEXT,
  buildWbVariantA,
  buildWbVariantB,
  STATUS_FILE_TEXT,
} from "../../../tests/fixtures/businessRules/artifacts.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { createArtifactInspection } from "../../domain/artifactInspection.js";
import { createEvidence } from "../../domain/evidence.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { inventoryArtifact } from "./ArtifactInventory.js";

const inventoryInspection = async (name: string, bytes: Buffer | string) => {
  const directory = await createTestTempDirectory("rea-br-classify-");
  const path = join(directory, name);
  await writeFile(path, bytes);
  const inventory = await inventoryArtifact(path);
  const evidence = createEvidence(
    {
      path,
      sha256: inventory.manifest.root_sha256,
      format: inventory.manifest.root_format,
    },
    { id: "rea-artifact-graph", name: "artifact inventory", version: "1" },
    {
      operation: "inventory_artifact",
      parameters: { integrity_policy: "fail" },
      result: jsonValueSchema.parse(inventory),
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
  return { inventory, inspection: createArtifactInspection(evidence) };
};

describe("Business Rules! artifact classification", () => {
  it("classifies compiled programs by content with a parsing next probe", async () => {
    for (const build of [buildWbVariantA, buildWbVariantB]) {
      const { inventory, inspection } = await inventoryInspection(
        "PROGRAM.WB",
        build(),
      );
      expect(inventory.manifest.root_format).toBe("br-compiled");
      expect(inspection.subject.root_format).toBe("br-compiled");
      expect(inspection.next_probes.map((probe) => probe.operation)).toEqual([
        "inspect_business_rules_artifact",
      ]);
    }
  });

  it("classifies status files, sources, procedures, screens, and configs", async () => {
    const cases = [
      ["[WBWORK]ST-FILE.01", STATUS_FILE_TEXT, "br-status"],
      ["UPGRADE.WBS", BR_SOURCE_TEXT, "br-source"],
      ["2D.brs", BR_SOURCE_TEXT, "br-source"],
      ["A11.PRC", "LET T(1)=0\r\n", "br-procedure"],
      ["SCREEN.6", Buffer.from([0x01, 0x00, 0x00, 0x00, 0x04]), "br-screen"],
      ["WBConfig.Sys", "SETENV WBCONFIG 9.1J.001\r\n", "br-config"],
    ] as const;
    for (const [name, bytes, format] of cases) {
      const { inventory } = await inventoryInspection(name, bytes);
      expect(inventory.manifest.root_format, name).toBe(format);
      expect(inventory.occurrences[0]?.artifact_kind, name).toBe("resource");
    }
  });

  it("demotes plaintext saved with a compiled-program extension to source", async () => {
    const { inventory } = await inventoryInspection(
      "DIAFIX.WB",
      "00010 PRINT NEWPAGE\r\n",
    );
    expect(inventory.manifest.root_format).toBe("br-source");
  });

  it("detects compiled-program bytes under a non-BR name", async () => {
    const { inventory } = await inventoryInspection(
      "snapshot.bin",
      buildWbVariantB(),
    );
    expect(inventory.manifest.root_format).toBe("br-compiled");
  });
});
