import { z } from 'zod';

const sheetId = z.string().min(1).max(64);
const range = z.string().min(1).max(24);
const cell = z
  .object({ address: z.string().min(2).max(8), value: z.string().max(10_000) })
  .strict();
const color = z.string().regex(/^(#[0-9a-fA-F]{6})?$/);
const style = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    fontFamily: z.enum(['sans', 'serif', 'mono']).optional(),
    fontSize: z.number().int().min(8).max(36).optional(),
    textColor: color.optional(),
    fillColor: color.optional(),
    horizontalAlign: z.enum(['auto', 'left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    wrap: z.boolean().optional(),
    borderTop: z.boolean().optional(),
    borderRight: z.boolean().optional(),
    borderBottom: z.boolean().optional(),
    borderLeft: z.boolean().optional(),
    decimals: z.number().int().min(-1).max(10).optional(),
    format: z
      .enum([
        'general',
        'number',
        'currency',
        'percent',
        'date',
        'time',
        'scientific',
        'text',
      ])
      .optional(),
  })
  .strict();
const name = z.string().min(1).max(31);
const operation = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('set_cells'),
      sheetId,
      cells: z.array(cell).min(1).max(2_000),
    })
    .strict(),
  z.object({ type: z.literal('format_cells'), sheetId, range, style }).strict(),
  z
    .object({
      type: z.literal('clear_cells'),
      sheetId,
      range,
      clearFormatting: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('fill_cells'),
      sheetId,
      sourceRange: range,
      targetRange: range,
    })
    .strict(),
  z.object({ type: z.literal('add_sheet'), name }).strict(),
  z.object({ type: z.literal('rename_sheet'), sheetId, name }).strict(),
  z
    .object({
      type: z.literal('duplicate_sheet'),
      sheetId,
      name: name.optional(),
    })
    .strict(),
  z.object({ type: z.literal('delete_sheet'), sheetId }).strict(),
  z
    .object({
      type: z.literal('append_rows'),
      sheetId,
      count: z.number().int().min(1).max(800),
    })
    .strict(),
  z
    .object({
      type: z.literal('resize_columns'),
      sheetId,
      columns: z
        .array(
          z
            .object({
              column: z.string().regex(/^[a-z]$/i),
              width: z.number().int().min(64).max(640),
            })
            .strict()
        )
        .min(1)
        .max(26),
    })
    .strict(),
]);

export const spreadsheetRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('read'),
      sheetId: sheetId.optional(),
      ranges: z.array(range).max(20).optional(),
      includeStyles: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('calculate'),
      sheetId: sheetId.optional(),
      formulas: z
        .array(
          z
            .object({
              label: z.string().max(100).optional(),
              formula: z.string().min(2).max(10_000),
            })
            .strict()
        )
        .min(1)
        .max(20),
      overrides: z
        .array(z.object({ sheetId, cells: z.array(cell).max(2_000) }).strict())
        .max(10)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('edit'),
      expectedRevision: z.string().min(1).max(100_000),
      operations: z.array(operation).min(1).max(25),
    })
    .strict(),
]);

export const spreadsheetBodySchema = z
  .object({
    documentId: z.string().uuid(),
    documentToken: z.string().min(1).max(16_384),
    request: spreadsheetRequestSchema,
  })
  .strict();
