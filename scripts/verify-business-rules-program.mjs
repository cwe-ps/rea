#!/usr/bin/env node
// Compare REA's Business Rules! listings with a caller-supplied reference
// decoder over a caller-selected corpus. Reports counts and file names only;
// program text never leaves the comparison.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { availableParallelism } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const corpus = process.env.REA_BR_CORPUS;
if (corpus === undefined || corpus === "") {
  console.log(
    "verify:business-rules skipped: set REA_BR_CORPUS to an absolute directory of compiled .br/.wb programs and REA_BR_REFERENCE_DECODER to the reference `decode` script.",
  );
  process.exit(0);
}
const reference = process.env.REA_BR_REFERENCE_DECODER;
const python = process.env.REA_BR_PYTHON ?? "python3";
if (!isAbsolute(corpus) || !isAbsolute(reference ?? ""))
  throw new Error(
    "verify:business-rules requires absolute REA_BR_CORPUS and REA_BR_REFERENCE_DECODER paths.",
  );
try {
  await access(corpus, constants.R_OK);
  await access(reference, constants.R_OK);
} catch (cause) {
  throw new Error(
    "verify:business-rules prerequisite unavailable: corpus directory or reference decoder",
    { cause },
  );
}

const entrypoint =
  process.argv[2] ?? fileURLToPath(new URL("./rea.mjs", import.meta.url));
const execute = promisify(execFile);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);

const programs = (
  await readdir(corpus, { recursive: true, withFileTypes: true })
)
  .filter((entry) => entry.isFile() && /\.(?:br|wb)$/iu.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();
if (programs.length === 0)
  throw new Error(`No .br/.wb programs found under ${corpus}`);

const runCli = async (path) => {
  try {
    const { stdout } = await execute(
      process.execPath,
      [entrypoint, "inspect-business-rules-program", path, "--json"],
      { env: environment, maxBuffer: 512 * 1024 * 1024, timeout: 120_000 },
    );
    return JSON.parse(stdout);
  } catch (cause) {
    if (typeof cause?.stdout === "string" && cause.stdout.trim() !== "")
      return JSON.parse(cause.stdout);
    throw cause;
  }
};

const runReference = async (path) => {
  try {
    const { stdout, stderr } = await execute(python, [reference, path], {
      encoding: "buffer",
      maxBuffer: 512 * 1024 * 1024,
      timeout: 120_000,
    });
    return {
      code: 0,
      stdout: stdout.toString("latin1"),
      stderr: String(stderr),
    };
  } catch (cause) {
    if (typeof cause?.code !== "number") throw cause;
    return {
      code: cause.code,
      stdout: "",
      stderr: Buffer.from(cause.stderr ?? "").toString("utf8"),
    };
  }
};

const listingText = (lines) =>
  lines
    .map((line) => `${String(line.number).padStart(5, "0")} ${line.text}\n`)
    .join("");

const tally = new Map();
const failures = [];
const count = (key) => tally.set(key, (tally.get(key) ?? 0) + 1);
let decodedSample;
let strippedSample;

const compare = async (path) => {
  const name = relative(corpus, path);
  const [evidence, expected] = await Promise.all([
    runCli(path),
    runReference(path),
  ]);
  const result = evidence?.normalized_result;
  const status = result?.listing?.status ?? "error";
  if (expected.code === 0) {
    if (status !== "decoded") {
      count("reference-decoded/rea-not-decoded");
      failures.push(`${name}: REA listing ${status}`);
      return;
    }
    const actual = listingText(result.listing.lines);
    if (actual === expected.stdout) {
      count("match");
      decodedSample ??= path;
      return;
    }
    const actualLines = actual.split("\n");
    const expectedLines = expected.stdout.split("\n");
    const first = expectedLines.findIndex(
      (line, index) => line !== actualLines[index],
    );
    count("mismatch");
    failures.push(
      `${name}: first differing output line ${String(first + 1)} (reference ${String(expectedLines.length)} lines, REA ${String(actualLines.length)})`,
    );
    return;
  }
  if (expected.stderr.includes("saved LIST section removed")) {
    if (status === "absent") {
      count("stripped/absent");
      strippedSample ??= path;
    } else {
      count("stripped/rea-disagrees");
      failures.push(`${name}: reference stripped, REA listing ${status}`);
    }
    return;
  }
  if (status === "decoded") {
    count("reference-rejected/rea-decoded");
    failures.push(`${name}: reference rejected (${expected.stderr.trim()})`);
  } else
    count(
      `both-rejected/${status === "error" ? (evidence?.code ?? "error") : status}`,
    );
};

const queue = [...programs];
const workers = Array.from(
  { length: Math.max(1, Math.min(8, availableParallelism())) },
  async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift())
      await compare(path);
  },
);
await Promise.all(workers);

// CLI and MCP share one workflow; confirm equivalent results on samples.
const client = new Client({ name: "business-rules-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
await client.connect(transport);
try {
  for (const sample of [decodedSample, strippedSample]) {
    if (sample === undefined) continue;
    const response = await client.callTool({
      name: "inspect_business_rules_program",
      arguments: { path: sample },
    });
    assert.notEqual(response.isError, true, sample);
    const cli = await runCli(sample);
    assert.deepEqual(
      response.structuredContent.normalized_result,
      cli.normalized_result,
      `CLI/MCP results differ for ${relative(corpus, sample)}`,
    );
  }
} finally {
  await client.close();
}

const comparable =
  (tally.get("match") ?? 0) +
  (tally.get("mismatch") ?? 0) +
  (tally.get("reference-decoded/rea-not-decoded") ?? 0);
const report = {
  programs: programs.length,
  outcomes: Object.fromEntries([...tally].sort()),
  listing_match_rate:
    comparable === 0
      ? null
      : `${String(tally.get("match") ?? 0)}/${String(comparable)}`,
  cli_mcp_samples: [decodedSample, strippedSample].filter(
    (sample) => sample !== undefined,
  ).length,
  failures: failures.slice(0, 50),
};
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exitCode = 1;
