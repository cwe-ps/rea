#!/usr/bin/env node
// Compare REA's Business Rules! listings with a caller-supplied reference
// decoder over a caller-selected corpus. Reports counts and file names only;
// program text never leaves the comparison.
//
// REA_BR_COMPARE selects the comparison:
//   listings (default)  CLI listings: saved-list basis for programs with a
//                       saved LIST, execution-stream basis for stripped ones.
//   from-exec           REA's execution-stream decoder on programs that keep a
//                       saved LIST, against the reference `--from-exec` mode.
//   all                 both.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
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
const mode = process.env.REA_BR_COMPARE ?? "listings";
if (!["listings", "from-exec", "all"].includes(mode))
  throw new Error(
    `REA_BR_COMPARE must be listings, from-exec or all (got ${mode}).`,
  );
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
const decoderModule = (name) =>
  import(new URL(`../dist/businessRules/${name}.js`, import.meta.url).href);
const { readBusinessRulesHeader, readBusinessRulesSymbols } =
  await decoderModule("BusinessRulesDecoder");
const { decodeBusinessRulesExecution } = await decoderModule(
  "BusinessRulesExecutionListing",
);
const execute = promisify(execFile);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
// The reference must print its default case convention, as UTF-8.
const referenceEnvironment = Object.fromEntries([
  ...Object.entries(environment).filter(
    ([key]) => !["BR_CASE", "BR_FN", "BR_LABEL"].includes(key),
  ),
  ["PYTHONIOENCODING", "utf-8"],
]);

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

const runReference = async (path, fromExec = false) => {
  try {
    const { stdout, stderr } = await execute(
      python,
      ["-I", reference, path, ...(fromExec ? ["--from-exec"] : [])],
      {
        env: referenceEnvironment,
        encoding: "buffer",
        maxBuffer: 512 * 1024 * 1024,
        timeout: 120_000,
      },
    );
    const text = stdout.toString("utf8");
    // The reference reports layouts it cannot decode on stderr with no output.
    return {
      code: text === "" && String(stderr).trim() !== "" ? -1 : 0,
      stdout: text,
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

const pad = (number) => String(number).padStart(5, "0");
const listingText = (lines) =>
  lines.map((line) => `${pad(line.number)} ${line.text}\n`).join("");

/** Line-table slots in table order, occupied slots, and the active chain. */
const lineTable = (data) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tableStart = view.getUint32(22);
  const count = view.getUint32(30);
  const slots = Array.from({ length: count }, (_, index) => {
    const offset = tableStart + 14 * index;
    return {
      offset,
      number: view.getUint32(offset) & 0xffffff,
      link: view.getUint16(offset + 12),
      empty: data.subarray(offset, offset + 14).every((byte) => byte === 0),
    };
  });
  const chain = [];
  const seen = new Set();
  for (let index = view.getUint16(12); index !== 0xfffe;) {
    if (index >= count || seen.has(index)) break;
    seen.add(index);
    chain.push(index);
    index = slots[index].link;
  }
  const occupied = slots.flatMap((slot, index) => (slot.empty ? [] : [index]));
  return { slots, chain, occupied };
};

const EXEC_BANNER = "! decoded-from: execution-stream\n";

/**
 * The reference prints a banner, then one record per line-table slot in table
 * order, including empty slots. Split its output into per-slot records.
 */
const referenceRecords = (slots, output) => {
  if (!output.startsWith(EXEC_BANNER)) return null;
  const body = output.slice(EXEC_BANNER.length);
  const records = [];
  let position = 0;
  for (const [index, slot] of slots.entries()) {
    if (!body.startsWith(`${pad(slot.number)} `, position)) return null;
    const following = slots[index + 1];
    let end = body.length;
    if (following !== undefined) {
      end = body.indexOf(`\n${pad(following.number)} `, position);
      if (end < 0) return null;
      end += 1;
    }
    records.push(body.slice(position, end));
    position = end;
  }
  return records;
};

/**
 * REA's decoder over an in-memory copy whose chain is re-linked through the
 * occupied slots in table order: the traversal the reference uses (its block
 * depth follows table order). The corpus file is not modified.
 */
const decodeInTableOrder = (data, occupied) => {
  const copy = Buffer.from(data);
  const header = readBusinessRulesHeader(copy);
  if (!header.ok) return null;
  const { tableStart } = header.value;
  for (const [position, slot] of occupied.entries())
    copy.writeUInt16BE(
      occupied[position + 1] ?? 0xfffe,
      tableStart + 14 * slot + 12,
    );
  const relinked = { ...header.value, firstLine: occupied[0] ?? 0xfffe };
  const symbols = readBusinessRulesSymbols(copy, relinked);
  if (!symbols.ok) return null;
  const decoded = decodeBusinessRulesExecution(copy, relinked, symbols.value);
  return decoded.ok ? listingText(decoded.value) : null;
};

/** Case- and whitespace-insensitive comparison key outside string literals. */
const looseKey = (text) => {
  let output = "";
  let quote = null;
  for (const character of text.replaceAll("\r", "")) {
    if (quote !== null) {
      output += character;
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
      output += character;
    } else if (!/\s/u.test(character)) output += character.toUpperCase();
  }
  return output;
};

const tally = new Map();
const failures = [];
const count = (key) => tally.set(key, (tally.get(key) ?? 0) + 1);
const fail = (text, blocking = true) => failures.push({ text, blocking });
const unknownMarkers = new Map();
let filesWithUnknowns = 0;
const samples = {};

const firstDifference = (actual, expected) => {
  const actualLines = actual.split("\n");
  const expectedLines = expected.split("\n");
  const first = expectedLines.findIndex(
    (line, index) => line !== actualLines[index],
  );
  return `first differing output line ${String(first + 1)} (reference ${String(expectedLines.length)} lines, REA ${String(actualLines.length)})`;
};

/**
 * Execution-stream comparison. `table-order`: REA's decoder traversing slots
 * as the reference does must reproduce the reference byte for byte (empty
 * slots excluded). `program-order`: REA's actual listing, in line-table chain
 * order, against the reference records rearranged into that order; block
 * indentation may differ where lines were inserted out of slot order.
 */
const compareExecution = ({ bucket, name, data, actual, expected }) => {
  const { slots, chain, occupied } = lineTable(data);
  const records = referenceRecords(slots, expected);
  if (records === null) {
    count(`${bucket}/failed-reference-layout`);
    fail(`${name}: reference ${bucket} output not split by slot`);
    return false;
  }
  const tableOrder = occupied.map((index) => records[index]).join("");
  const tableActual = decodeInTableOrder(data, occupied);
  if (tableActual === tableOrder) count(`${bucket}/table-order/identical`);
  else {
    count(`${bucket}/table-order/different`);
    fail(
      `${name}: ${bucket} table-order ${tableActual === null ? "not decoded" : firstDifference(tableActual, tableOrder)}`,
    );
  }
  const programOrder = chain.map((index) => records[index]).join("");
  if (actual === programOrder) {
    count(`${bucket}/program-order/identical`);
    return tableActual === tableOrder;
  }
  const unindented = (text) => text.replaceAll(/^(\d{5} ) +/gmu, "$1");
  if (unindented(actual) === unindented(programOrder))
    count(`${bucket}/program-order/different-indentation-only`);
  else {
    count(`${bucket}/program-order/different`);
    fail(
      `${name}: ${bucket} program-order ${firstDifference(actual, programOrder)}`,
    );
  }
  return false;
};

/** Saved-LIST text: strict identity, else equivalence ignoring case and spacing. */
const compareSavedList = (name, path, actual, expected) => {
  if (actual === expected) {
    count("saved-list/identical");
    samples.savedList ??= path;
    return;
  }
  const keys = (text) =>
    text
      .split(/\n(?=\d{5} )/u)
      .map(looseKey)
      .join("\n");
  if (keys(actual) === keys(expected)) {
    count("saved-list/equivalent-ignoring-case-and-spacing");
    samples.savedList ??= path;
  } else {
    count("saved-list/different");
    fail(`${name}: saved-list ${firstDifference(actual, expected)}`, false);
  }
};

const compareListing = async (path) => {
  const name = relative(corpus, path);
  const data = await readFile(path);
  const [evidence, expected] = await Promise.all([
    runCli(path),
    runReference(path),
  ]);
  const result = evidence?.normalized_result;
  const listing = result?.listing;
  const stripped = result?.header?.sections?.listing?.bytes === 0;
  const bucket = stripped ? "execution-stream" : "saved-list";
  if (listing?.status !== "decoded") {
    count(
      expected.code === 0 ? `${bucket}/failed-rea` : `${bucket}/failed-both`,
    );
    if (expected.code === 0)
      fail(`${name}: REA listing ${listing?.status ?? "error"}`);
    return;
  }
  if (expected.code !== 0) {
    count(`${bucket}/failed-reference`);
    return;
  }
  const actual = listingText(listing.lines);
  if (stripped) {
    assert.equal(listing.basis, "execution-stream", name);
    for (const { marker } of listing.unknown_markers)
      unknownMarkers.set(marker, (unknownMarkers.get(marker) ?? 0) + 1);
    if (listing.unknown_markers.length > 0) filesWithUnknowns += 1;
    if (
      compareExecution({
        bucket,
        name,
        data,
        actual,
        expected: expected.stdout,
      })
    )
      samples.executionStream ??= path;
    return;
  }
  assert.equal(listing.basis, "saved-list", name);
  compareSavedList(name, path, actual, expected.stdout);
};

const compareFromExec = async (path) => {
  const name = relative(corpus, path);
  const data = await readFile(path);
  const header = readBusinessRulesHeader(data);
  if (!header.ok || !header.value.modern || header.value.listingSize === 0)
    return;
  const symbols = readBusinessRulesSymbols(data, header.value);
  const decoded = symbols.ok
    ? decodeBusinessRulesExecution(data, header.value, symbols.value)
    : symbols;
  const expected = await runReference(path, true);
  if (!decoded.ok || expected.code !== 0) {
    count(
      !decoded.ok && expected.code !== 0
        ? "from-exec/failed-both"
        : decoded.ok
          ? "from-exec/failed-reference"
          : "from-exec/failed-rea",
    );
    if (!decoded.ok) fail(`${name}: REA ${decoded.error.message}`);
    return;
  }
  compareExecution({
    bucket: "from-exec",
    name,
    data,
    actual: listingText(decoded.value),
    expected: expected.stdout,
  });
};

const runAll = async (task) => {
  const queue = [...programs];
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(8, availableParallelism())) },
      async () => {
        for (let path = queue.shift(); path !== undefined; path = queue.shift())
          await task(path);
      },
    ),
  );
};

if (mode !== "from-exec") await runAll(compareListing);
if (mode !== "listings") await runAll(compareFromExec);

// CLI and MCP share one workflow; confirm equivalent results on samples.
const sampled = Object.values(samples);
if (sampled.length > 0) {
  const client = new Client({ name: "business-rules-verifier", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env: environment,
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    for (const sample of sampled) {
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
}

const outcomes = Object.fromEntries([...tally].sort());
console.log(
  JSON.stringify(
    {
      programs: programs.length,
      compare: mode,
      outcomes,
      execution_stream_unknown_markers:
        mode === "from-exec"
          ? null
          : {
              markers: [...unknownMarkers.values()].reduce(
                (total, value) => total + value,
                0,
              ),
              files: filesWithUnknowns,
              by_marker: Object.fromEntries([...unknownMarkers].sort()),
            },
      cli_mcp_samples: sampled.length,
      failure_count: failures.length,
      blocking_failures: failures
        .filter((failure) => failure.blocking)
        .map(({ text }) => text),
      failures: failures
        .filter((failure) => !failure.blocking)
        .slice(0, 30)
        .map(({ text }) => text),
    },
    null,
    2,
  ),
);
// Execution-stream output is held to identity with the reference in table
// order, and to identity up to block indentation in program order. Saved-LIST
// rendering intentionally keeps the stored uppercase spelling, so differences
// there are reported; only an REA-side saved-LIST failure blocks.
const blocking = Object.keys(outcomes).some(
  (key) =>
    key === "saved-list/failed-rea" ||
    /^(?:execution-stream|from-exec)\/(?:failed-rea|failed-reference-layout|table-order\/different|program-order\/different)$/u.test(
      key,
    ),
);
if (blocking) process.exitCode = 1;
