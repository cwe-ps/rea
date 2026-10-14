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
  A decoded listing names its `basis`: `saved-list` when the program keeps the
  tokenized LIST the compiler stores beside the execution stream (always
  preferred when present), or `execution-stream` when that LIST was removed
  (see [Stripped programs](#stripped-programs)). Each line has its program
  `number`, reconstructed `text` (statement continuations such as `!:` keep
  their embedded newlines), the absolute `record_offset` of its source, and
  whether that source is `embedded` in the execution section. For `saved-list`
  the offset is the saved record; for `execution-stream` it is the line's
  compiled code, or the embedded DIM/DATA source record (`embedded: true`).
  Unresolved saved-LIST keyword codes stay visible as `[[gg:cc]]` and are
  listed in `unresolved_keywords`; execution-stream unknowns are listed per
  line in `unknown_markers` (`{ line, marker }`).
- `symbols`: modern symbol slots with index, offset, name (`null` for nameless
  constants), observed kind (`scalar`, `array`, `function`, `string-constant`,
  `numeric-constant`), value type, raw attribute flags, declared width,
  definition slot, array dimensions and constant metadata. Numeric constants are
  big-endian IEEE-754 values with their raw bits; non-finite values report
  `numeric_value: null`. Legacy symbol payloads are reported as `unsupported`.
- `string_constants`: raw string literals from the symbol pool, keyed by
  symbol index. Its status follows the symbol table.
- `references`: OPEN (`files_opened`), CHAIN (`programs_chained`), EXECUTE
  (`commands_executed`), LIBRARY and DEF operands **derived** from the
  decoded listing statements. Operands are reported as written; computed
  expressions are not evaluated, and OPEN entries include window/screen opens.
  When the listing is not decoded, `references.status` is `unknown`.
- `stripped_legacy`: `null` unless the program uses the legacy layout and its
  saved LIST was removed; see [Stripped legacy programs](#stripped-legacy-programs).

## Stripped programs

Many deployed programs have a zero-length saved LIST. For the modern layout,
REA then decompiles the execution stream in process, using the line table for
program order and jump targets and the symbol table for operands, and returns
`listing.basis: "execution-stream"` with references derived from the decompiled
OPEN, CHAIN, LIBRARY and DEF statements.

The execution stream is postfix stack code: an operand group (count, then
little-endian u16 operands where `0x100 + i` is symbol slot `i`) starts each
statement, op bytes carry a six-bit opcode and a two-bit mode, and jump
operands are line-table positions. DIM and DATA lines keep their source record
after their code even in stripped programs and are rendered from it.

What the execution stream does not store cannot be recovered:

- comments and REM text (comment-only lines appear as `!`) and labels (all
  jump targets are shown as line numbers);
- keyword abbreviations (`PR`/`PRINT`), implicit versus explicit `LET`,
  identifier case, quote style, redundant parentheses (minimal parentheses are
  emitted by precedence), numeric literal spelling (`.5`), `==`/`=>` aliases,
  `udim(mat X)` versus `udim(X)` and explicit default `*18` lengths;
- indentation, which is synthesized at two spaces per block level.

Execution-stream text follows the reference decoder's default case convention:
keywords and builtin functions lowercase, other identifiers Title_Case per
underscore-separated part (`CUSTOMER_NAME$` becomes `Customer_Name$`), string
literals double-quoted with doubled embedded quotes. There is no case option.
Instructions REA does not recognize stay in the text as `<?...>` markers (for
example `<?X06/0>` for an unknown expression op), and a line whose code cannot
be parsed is kept as `! <undecodable: kind> hex`; both are listed in
`unknown_markers`.

Programs with the legacy little-endian layout and no saved LIST keep
`listing.status: "absent"` with header and section layout; REA has no
execution-stream or symbol decoder for that layout. Their observed facts are
reported in `stripped_legacy` instead.

### Stripped legacy programs

`stripped_legacy` (`evidence_kind: "observed"`) carries what the legacy
container still states without decoding its execution stream:

- `line_table`: the active line-table chain in program order. Each line has its
  program `number`, table `slot`, raw high flag byte `flags` (only `0x02`,
  embedded source, is understood), the absolute `code_offset` of its compiled
  code, and whether it is `embedded`. DIM and DATA lines keep their source
  record inside the execution section; for those, `record_offset` and the
  rendered `text` are reported. Other lines have `text: null`. A damaged
  chain gives `status: "malformed"` with the `reason` and no lines.
- `symbol_section_strings`: printable ASCII runs of at least four bytes inside
  the legacy symbol section, with absolute offsets. They show symbol names and
  string literals but are raw byte observations: slot boundaries are not
  decoded, adjacent printable attribute bytes can extend a run, and names
  shorter than four bytes are missed.

The legacy statement code, symbol slot layout and references remain unknown. If the symbol table or line
table of a stripped program is damaged, the listing is `malformed` with the
reason, and references are unknown.

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
Execution-stream limits are listed under [Stripped programs](#stripped-programs).

## Verification

The stripped-legacy line table was checked against a local corpus of 178
legacy stripped programs: every chain was complete and strictly ascending
(30,047 lines), and all 896 embedded DIM/DATA records matched their slot's
line number and tokenized.

`npm run verify:business-rules` compares every `.br`/`.wb` program under
`REA_BR_CORPUS` with a reference decoder selected by
`REA_BR_REFERENCE_DECODER`, for saved-LIST and execution-stream listings and,
with `REA_BR_COMPARE=from-exec`, REA's execution-stream decoder on programs
that also keep a saved LIST. It checks CLI/MCP equivalence on samples and
reports counts and file names only; see [testing](testing.md).
