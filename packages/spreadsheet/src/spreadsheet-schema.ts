import { schema } from '@macro-inc/automerge/mirror';

// Root maps have stable identities even when two peers first edit an empty
// cell concurrently. Separate properties also let formatting and value edits
// merge independently. Calculated values are deliberately never persisted.
export const SPREADSHEET_AUTOMERGE_SCHEMA = schema({
  spreadsheetSheetMetadata: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetSheetNames: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetSheetOrder: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  spreadsheetDeletedSheets: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetSheetRevivals: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetSheetRetentions: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetValues: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBold: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetFontNames: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBorderTopStyles: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBorderTopColors: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBorderRightStyles: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBorderRightColors: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBorderBottomStyles: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBorderBottomColors: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBorderLeftStyles: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetBorderLeftColors: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetNumberFormats: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetFormats: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetItalic: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetUnderline: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetStrikethrough: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetWrap: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetBorderTop: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetBorderRight: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetBorderBottom: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetBorderLeft: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Boolean>>
  ),
  spreadsheetFontFamily: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetTextColor: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetFillColor: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetHorizontalAlign: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetVerticalAlign: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.String>>
  ),
  spreadsheetFontSize: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  spreadsheetDecimals: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  spreadsheetColumnWidths: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
  spreadsheetRowAdditions: schema.AutomergeMap(
    {} as Record<string, ReturnType<typeof schema.Number>>
  ),
});
