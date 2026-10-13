# Compiled Business Rules! programs

`inspect_business_rules_program` / `inspect-business-rules-program` decodes one
explicitly selected compiled Business Rules! (BR) program (`.br`, `.wb`). It
runs entirely in process: no BR runtime, program execution, paired source or
network access is involved, and no active native binary target is required.

```sh
rea inspect-business-rules-program ./PAYROLL.WB --json
```

```json
{
  "name": "inspect_business_rules_program",
  "arguments": { "path": "/programs/PAYROLL.WB" }
}
```

## Result

- `artifact`: selected path, SHA-256 and byte length.
- `header`: `modern` (51-byte, big-endian) or `legacy` (30/32-byte,
  little-endian) variant; version and option bytes in raw hex (their meanings
  are unknown); first active line slot, slot counts, whether historical clause
  codes apply, and the offset/size of the execution, line-table, symbol and
  saved-LIST sections.
- `listing`: `status` is `decoded`, `absent`, `unsupported` or `malformed`.
  A decoded listing names its `basis`; today that is always `saved-list`, the
  tokenized LIST representation the compiler keeps beside the execution
  stream. `execution-stream` is reserved for a future decoder of programs whose
  saved LIST was removed. Each line has its program `number`, reconstructed
  `text` (statement continuations such as `!:` keep their embedded newlines),
  the absolute `record_offset` of its saved record, and whether that record is
  `embedded` in the execution section (as DIM records are). Unresolved keyword
  codes stay visible as `[[gg:cc]]` and are listed in `unresolved_keywords`.
- `symbols`: modern symbol slots with index, offset, name (`null` for nameless
  constants), observed kind (`scalar`, `array`, `function`, `string-constant`,
  `numeric-constant`), value type, raw attribute flags, declared width,
  definition slot, array dimensions and constant metadata. Numeric constants are
  big-endian IEEE-754 values with their raw bits; non-finite values report
  `numeric_value: null`. Legacy symbol payloads are reported as `unsupported`.
- `string_constants`: raw string literals from the symbol pool, keyed by
  symbol index. Its status follows the symbol table.
- `references`: OPEN, CHAIN, LIBRARY and DEF operands **derived** from the
  decoded listing statements. Operands are reported as written; computed
  expressions are not evaluated, and OPEN entries include window/screen opens.
  When the listing is not decoded, `references.status` is `unknown`.

## Stripped programs

Many deployed programs have a zero-length saved LIST. They still return the
header, symbols and string constants, with `listing.status: "absent"`,
`listing.basis: null`, and unknown references. REA does not scan surviving
names or comments to imitate a listing.

## Failures

Files that do not carry a recognized BR header return `unsupported_target`.
Recognized headers with inconsistent section sizes are invalid input. Damaged
line-table chains, record pointers or tokens in an otherwise readable program
yield `listing.status: "malformed"` (or `unsupported` for an unknown token
group) while header and symbols are still reported; a damaged symbol table is
reported the same way without discarding the listing.

## Limits of the reconstruction

Compiled LIST stores canonical uppercase keywords and identifiers. Original
case, abbreviations (`PR` becomes `PRINT`), implicit assignments (shown with
`LET`), Lexi preprocessing and comments removed before compilation are not
recoverable. Some keyword spellings are inferred from compiled-only examples.
Execution-stream instructions are not decoded.

## Verification

`npm run verify:business-rules` compares every `.br`/`.wb` program under
`REA_BR_CORPUS` with a reference decoder selected by
`REA_BR_REFERENCE_DECODER`, and checks CLI/MCP equivalence on samples. It
reports counts and file names only; see [testing](testing.md).
