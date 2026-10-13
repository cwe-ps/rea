import { createHash } from "node:crypto";
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
  body,
  modernProgram,
  run,
  stripListing,
  symbol,
  u32,
} from "../../fixtures/businessRules/program.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("advertises valid schemas and records decoded program evidence without a binary target", async () => {
  const directory = await createTestTempDirectory("rea-br-mcp-");
  const program = modernProgram(
    [
      { number: 10, body: body(0x01, 0x31, run(5, '"MENU"')) },
      { number: 20, body: body(0x01, 0x2f) },
    ],
    {
      symbols: symbol("", 0x6040, Buffer.concat([u32(4), Buffer.from("MENU")])),
      symbolSlots: 1,
    },
  );
  const listed = join(directory, "LISTED.WB");
  const stripped = join(directory, "STRIPPED.br");
  await writeFile(listed, program);
  await writeFile(stripped, stripListing(program));
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
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
    (tool) => tool.name === "inspect_business_rules_program",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("Business Rules! inspection must publish both schemas");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(ajv.validateSchema(inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  expect(ajv.validate(inputSchema, { path: listed })).toBe(true);
  expect(ajv.validate(inputSchema, { path: listed, approval: true })).toBe(
    false,
  );

  const contract = toolContract("inspect_business_rules_program");
  const inspect = async (path: string) => {
    const response = await client.callTool({
      name: "inspect_business_rules_program",
      arguments: { path },
    });
    expect(response.isError).not.toBe(true);
    expect(
      ajv.validate(outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const parsed = contract.outputSchema.parse(response.structuredContent);
    const evidence = parseEvidence(parsed);
    expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);
    return { evidence, result: parsed.normalized_result };
  };

  const decoded = await inspect(listed);
  expect(decoded.evidence.confidence).toBe("derived");
  expect(decoded.evidence.subject?.digest.sha256).toBe(
    createHash("sha256").update(program).digest("hex"),
  );
  expect(decoded.result.listing.lines.map((line) => line.text)).toEqual([
    'CHAIN "MENU"',
    "END",
  ]);
  expect(decoded.result.references.programs_chained).toEqual([
    { line: 10, expression: '"MENU"', literal: "MENU" },
  ]);

  const absent = await inspect(stripped);
  expect(absent.result.listing.status).toBe("absent");
  expect(absent.result.string_constants.values).toEqual([
    { symbol_index: 0, value: "MENU" },
  ]);

  expect(
    (
      await client.callTool({
        name: "inspect_business_rules_program",
        arguments: { path: "relative.wb" },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await client.callTool({
        name: "inspect_business_rules_program",
        arguments: { path: listed, extra: true },
      })
    ).isError,
  ).toBe(true);
});
