import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it, onTestFinished } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import {
  BR_SOURCE_TEXT,
  buildWbVariantB,
  STATUS_FILE_TEXT,
} from "../../fixtures/businessRules/artifacts.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("parses BR artifacts through the real provider and publishes valid schemas", async () => {
  const directory = await createTestTempDirectory("rea-br-mcp-");
  const program = join(directory, "EXAMPLE.WB");
  const status = join(directory, "[WBWORK]ST-FILE.07");
  const source = join(directory, "EXAMPLE.brs");
  await writeFile(program, buildWbVariantB());
  await writeFile(status, STATUS_FILE_TEXT);
  await writeFile(source, BR_SOURCE_TEXT);

  const session = createTestBinarySession(() => {
    throw new Error("BR inspection must not acquire a deep provider");
  });
  const server = createServer(session, session);
  const client = new Client({ name: "business-rules-contract", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_business_rules_artifact",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("BR inspection must publish both schemas");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(ajv.validateSchema(inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  expect(ajv.validate(inputSchema, { path: program })).toBe(true);

  const contract = toolContract("inspect_business_rules_artifact");
  const call = async (path: string) => {
    const response = await client.callTool({
      name: "inspect_business_rules_artifact",
      arguments: { path },
    });
    expect(response.isError).not.toBe(true);
    expect(
      ajv.validate(outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    return contract.outputSchema.parse(response.structuredContent);
  };

  const compiled = await call(program);
  expect(compiled.normalized_result.format).toBe("br-compiled");
  if (compiled.normalized_result.format !== "br-compiled")
    throw new Error("expected a compiled program");
  expect(compiled.normalized_result.program.variant).toBe("B");
  expect(compiled.normalized_result.program.line_map.record_count).toBe(2);
  const evidence = parseEvidence(compiled);
  expect(evidence.confidence).toBe("observed");
  expect(evidence.subject?.format).toBe("br-compiled");
  expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);

  const statusResult = await call(status);
  if (statusResult.normalized_result.format !== "br-status")
    throw new Error("expected a status file");
  expect(statusResult.normalized_result.status.wsid).toBe(7);
  expect(statusResult.normalized_result.status.programs).toHaveLength(2);

  const sourceResult = await call(source);
  if (sourceResult.normalized_result.format !== "br-source")
    throw new Error("expected source");
  expect(
    sourceResult.normalized_result.source.references.map(({ kind }) => kind),
  ).toEqual(["open", "chain", "execute", "open"]);

  const plain = join(directory, "notes.txt");
  await writeFile(plain, "not a BR artifact");
  expect(
    (
      await client.callTool({
        name: "inspect_business_rules_artifact",
        arguments: { path: plain },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await client.callTool({
        name: "inspect_business_rules_artifact",
        arguments: { path: join(directory, "missing.wb") },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await client.callTool({
        name: "inspect_business_rules_artifact",
        arguments: { path: "relative.wb" },
      })
    ).isError,
  ).toBe(true);
});
