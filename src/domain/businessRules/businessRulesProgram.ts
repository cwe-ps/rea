import { z } from "zod";

const byteOffset = z.number().int().nonnegative();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const hexBytes = z.string().regex(/^(?:[0-9a-f]{2})*$/);
const section = z.strictObject({ offset: byteOffset, bytes: byteOffset });
const sectionStatus = z.enum(["decoded", "unsupported", "malformed"]);

/** Select one compiled Business Rules! program; no runtime or source pair is consulted. */
export const inspectBusinessRulesProgramInputSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .describe(
      "Absolute path to a caller-selected compiled Business Rules! program (.br/.wb)",
    ),
});

/**
 * One numbered program line. For the saved-list basis, `record_offset` is the
 * saved record; for the execution-stream basis it is the line's compiled code,
 * or the embedded DIM/DATA source record when `embedded` is true.
 */
const businessRulesListingLineSchema = z.strictObject({
  number: z.number().int().min(0).max(99_999),
  text: z.string(),
  record_offset: byteOffset,
  embedded: z.boolean(),
});

/** Symbol slot classification observed from modern type/attribute flags. */
export const businessRulesSymbolSchema = z.strictObject({
  index: byteOffset,
  offset: byteOffset,
  name: z.string().nullable(),
  kind: z.enum([
    "scalar",
    "array",
    "function",
    "string-constant",
    "numeric-constant",
  ]),
  value_type: z.enum(["string", "numeric"]),
  flags: z.number().int().min(0).max(0xffff),
  declared_width: byteOffset,
  definition_slot: z.number().int().min(0).max(0xffff),
  name_tag: z.number().int().min(0).max(0xff),
  dimensions: z.array(byteOffset).nullable(),
  string_length: byteOffset.nullable(),
  numeric_value: z.number().nullable(),
  numeric_bits: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
});

const lineReference = z.number().int().min(0).max(99_999);
const literalOrExpression = {
  expression: z.string(),
  literal: z.string().nullable(),
};

/** Header, saved LIST, symbols and listing-derived references for one compiled program. */
export const businessRulesProgramSchema = z
  .strictObject({
    artifact: z.strictObject({
      path: z.string().min(1),
      sha256,
      bytes: byteOffset,
    }),
    header: z.strictObject({
      variant: z.enum(["modern", "legacy"]),
      header_bytes: z.union([z.literal(30), z.literal(32), z.literal(51)]),
      byteorder: z.enum(["big", "little"]),
      version_bytes: hexBytes,
      option_bytes: hexBytes,
      first_line_slot: z.number().int().min(0).max(0xffff),
      line_slots: byteOffset,
      symbol_slots: byteOffset,
      legacy_clause_codes: z.boolean(),
      sections: z.strictObject({
        execution: section,
        line_table: section,
        symbols: section,
        listing: section,
      }),
    }),
    listing: z.strictObject({
      status: z.enum(["decoded", "absent", "unsupported", "malformed"]),
      basis: z.enum(["saved-list", "execution-stream"]).nullable(),
      reason: z.string().nullable(),
      lines: z.array(businessRulesListingLineSchema),
      unresolved_keywords: z.array(
        z.strictObject({
          group: z.enum(["statement", "clause"]),
          code: z.number().int().min(0).max(0xff),
        }),
      ),
      unknown_markers: z.array(
        z.strictObject({
          line: z.number().int().min(0).max(99_999),
          marker: z.string(),
        }),
      ),
    }),
    symbols: z.strictObject({
      status: sectionStatus,
      reason: z.string().nullable(),
      entries: z.array(businessRulesSymbolSchema),
    }),
    string_constants: z.strictObject({
      status: sectionStatus,
      values: z.array(
        z.strictObject({ symbol_index: byteOffset, value: z.string() }),
      ),
    }),
    references: z.strictObject({
      evidence_kind: z.literal("derived"),
      status: z.enum(["derived", "unknown"]),
      files_opened: z.array(
        z.strictObject({
          line: lineReference,
          channel: z.string().nullable(),
          ...literalOrExpression,
          name: z.string().nullable(),
        }),
      ),
      programs_chained: z.array(
        z.strictObject({ line: lineReference, ...literalOrExpression }),
      ),
      libraries: z.array(
        z.strictObject({
          line: lineReference,
          expression: z.string().nullable(),
          literal: z.string().nullable(),
          functions: z.array(z.string()),
        }),
      ),
      functions_defined: z.array(
        z.strictObject({
          line: lineReference,
          name: z.string(),
          library: z.boolean(),
        }),
      ),
    }),
    limitations: z.array(z.string()),
  })
  .superRefine((value, context) => {
    const { listing, references } = value;
    if (listing.status === "decoded" && listing.basis === null)
      context.addIssue({
        code: "custom",
        path: ["listing", "basis"],
        message: "A decoded listing must name its reconstruction basis.",
      });
    if (
      listing.status !== "decoded" &&
      (listing.lines.length > 0 ||
        listing.reason === null ||
        listing.unknown_markers.length > 0)
    )
      context.addIssue({
        code: "custom",
        path: ["listing"],
        message: "An undecoded listing must carry a reason and no lines.",
      });
    if ((listing.status === "decoded") !== (references.status === "derived"))
      context.addIssue({
        code: "custom",
        path: ["references", "status"],
        message: "References are derived only from a decoded listing.",
      });
    if (value.symbols.status !== value.string_constants.status)
      context.addIssue({
        code: "custom",
        path: ["string_constants", "status"],
        message: "String constants are read from the symbol table.",
      });
    for (const [index, line] of listing.lines.entries())
      if (line.record_offset >= value.artifact.bytes)
        context.addIssue({
          code: "custom",
          path: ["listing", "lines", index, "record_offset"],
          message: "Record offset lies outside the selected artifact.",
        });
  });

export type InspectBusinessRulesProgramInput = z.infer<
  typeof inspectBusinessRulesProgramInputSchema
>;
export type BusinessRulesProgram = z.infer<typeof businessRulesProgramSchema>;
export type BusinessRulesSymbol = z.infer<typeof businessRulesSymbolSchema>;
