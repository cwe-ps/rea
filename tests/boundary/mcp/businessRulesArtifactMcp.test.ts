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
  BR_SOURCE_TEXT,
  CONFIG_TEXT,
  SCREEN_BYTES,
  STATUS_FILE_TEXT,
} from "../../fixtures/businessRules/artifacts.js";
import { body, modernProgram } from "../../fixtures/businessRules/program.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("reads status, source, config, screen and compiled artifacts through MCP", async () => {
  const directory = await createTestTempDirectory("rea-br-artifact-mcp-");
  const status = join(directory, "[WBWORK]ST-FILE.07");
  const source = join(directory, "EXAMPLE.brs");
  const config = join(directory, "wbconfig.sys");
  const screen = join(directory, "SCREEN.042");
  const program = join(directory, "PROGRAM.WB");
  const notes = join(directory, "notes.txt");
  await writeFile(status, STATUS_FILE_TEXT, "latin1");
  await writeFile(source, BR_SOURCE_TEXT, "latin1");
  await writeFile(config, CONFIG_TEXT, "latin1");
  await writeFile(screen, SCREEN_BYTES);
  await writeFile(
    program,
    modernProgram([{ number: 10, body: body(0x01, 0x2e) }]),
  );
  await writeFile(notes, "plain notes\n");
  const session = createTestBinarySession(() => {
    throw new Error("deep provider must not start");
  });
  const server = createServer(session, session);
  const client = new Client({ name: "business-rules-artifact", version: "1" });
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
    throw new Error(
      "Business Rules! artifact inspection must publish both schemas",
    );
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const inputSchema: Record<string, unknown> = advertised.inputSchema;
  const outputSchema: Record<string, unknown> = advertised.outputSchema;
  expect(ajv.validateSchema(inputSchema)).toBe(true);
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  expect(ajv.validate(inputSchema, { path: status })).toBe(true);
  expect(ajv.validate(inputSchema, { path: status, format: "status" })).toBe(
    false,
  );

  const contract = toolContract("inspect_business_rules_artifact");
  const inspect = async (path: string) => {
    const response = await client.callTool({
      name: "inspect_business_rules_artifact",
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

  const statusFile = await inspect(status);
  expect(statusFile.evidence.confidence).toBe("observed");
  expect(statusFile.evidence.subject?.digest.sha256).toBe(
    createHash("sha256")
      .update(Buffer.from(STATUS_FILE_TEXT, "latin1"))
      .digest("hex"),
  );
  if (statusFile.result.format !== "status-file")
    throw new Error("expected a status file");
  expect(statusFile.result.status).toMatchObject({
    wsid: 7,
    program_id: "F:\\root\\LIBRARY\\EXAMPLE.WB",
    current_line: 120,
    last_error: 42,
  });

  const sourceText = await inspect(source);
  expect(sourceText.evidence.confidence).toBe("derived");
  if (sourceText.result.format !== "source-text")
    throw new Error("expected source text");
  expect(sourceText.result.source.references.programs_chained).toEqual([
    {
      line: 40,
      physical_line: 4,
      expression: '"BEGIN/PROG1"',
      literal: "BEGIN/PROG1",
    },
    { line: 60, physical_line: 6, expression: '"AFTER"', literal: "AFTER" },
  ]);

  const compiled = await inspect(program);
  expect(compiled.evidence.confidence).toBe("observed");
  if (compiled.result.format !== "compiled-program")
    throw new Error("expected a compiled-program observation");
  expect(compiled.result.program.variant).toBe("modern");
  expect(compiled.result.decode_with).toBe("inspect_business_rules_program");
  expect(compiled.result.limitations.join(" ")).toContain("token stream");

  const runtimeConfig = await inspect(config);
  if (runtimeConfig.result.format !== "runtime-config")
    throw new Error("expected a runtime configuration");
  expect(runtimeConfig.result.config.directives[0]).toEqual({
    line: 1,
    keyword: "SETENV",
    text: "SETENV WBCONFIG 9.1J.001",
  });

  const screenDefinition = await inspect(screen);
  if (screenDefinition.result.format !== "screen-file")
    throw new Error("expected a screen definition");
  expect(screenDefinition.result.classification.basis).toBe("extension-only");

  const text = await client.callTool({
    name: "inspect_business_rules_program",
    arguments: { path: source },
  });
  expect(text.isError).toBe(true);
  expect(JSON.stringify(text.content)).toMatch(
    /inspect_business_rules_artifact/u,
  );
  for (const path of [notes, join(directory, "missing.brs"), "relative.brs"])
    expect(
      (
        await client.callTool({
          name: "inspect_business_rules_artifact",
          arguments: { path },
        })
      ).isError,
    ).toBe(true);
});
