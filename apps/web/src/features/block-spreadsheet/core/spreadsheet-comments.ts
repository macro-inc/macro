import { positionFromAddress } from './grid-selection';

export const SPREADSHEET_COMMENT_PARAMS = { commentId: 'comment_id' } as const;

export type SpreadsheetCommentAnchor = {
  sheetId: string;
  sheetName: string;
  range: string;
};

/**
 * The cell range a message thread is anchored to, read from the thread's
 * `state.anchor` (`{ type: 'spreadsheet', sheet_id, sheet_name, range }`);
 * absent for workbook comments and other anchor types.
 */
export function spreadsheetCommentAnchor(
  anchor: unknown
): SpreadsheetCommentAnchor | undefined {
  if (
    !anchor ||
    typeof anchor !== 'object' ||
    !('type' in anchor) ||
    anchor.type !== 'spreadsheet' ||
    !('sheet_id' in anchor) ||
    !('sheet_name' in anchor) ||
    !('range' in anchor)
  )
    return;
  if (
    typeof anchor.sheet_id !== 'string' ||
    !anchor.sheet_id ||
    typeof anchor.sheet_name !== 'string' ||
    typeof anchor.range !== 'string'
  )
    return;
  const addresses = anchor.range.split(':');
  if (
    addresses.length > 2 ||
    !addresses.every(
      (address) =>
        /^[A-Z]+[1-9]\d*$/.test(address) && positionFromAddress(address)
    )
  )
    return;
  return {
    sheetId: anchor.sheet_id,
    sheetName: anchor.sheet_name,
    range: anchor.range,
  };
}
