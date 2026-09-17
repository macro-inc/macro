import { schema } from '@loro-mirror/core';

// Root maps have stable identities even when two peers first edit an empty
// cell concurrently. Separate properties also let formatting and value edits
// merge independently. Calculated values are deliberately never persisted.
export const SPREADSHEET_LORO_SCHEMA = schema({
  spreadsheetSheetNames: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetSheetOrder: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  spreadsheetDeletedSheets: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetSheetRevivals: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetSheetRetentions: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetValues: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBold: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetFormats: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetItalic: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetUnderline: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetStrikethrough: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetWrap: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetBorderTop: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetBorderRight: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetBorderBottom: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetBorderLeft: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetFontFamily: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetTextColor: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetFillColor: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetHorizontalAlign: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetVerticalAlign: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetFontSize: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  spreadsheetDecimals: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  spreadsheetColumnWidths: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  spreadsheetRowAdditions: schema.LoroMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
});
