import { positionFromAddress } from './grid-selection';

export const SPREADSHEET_COMMENT_PARAMS = { commentId: 'comment_id' } as const;

export type SpreadsheetCommentAnchor = {
  sheetId: string;
  sheetName: string;
  range: string;
};

/** Stored on the existing document annotation thread, never in cell contents. */
export function spreadsheetCommentAnchor(
  metadata: unknown
): SpreadsheetCommentAnchor | undefined {
  if (!metadata || typeof metadata !== 'object' || !('spreadsheet' in metadata))
    return;
  const value = metadata.spreadsheet;
  if (
    !value ||
    typeof value !== 'object' ||
    !('sheetId' in value) ||
    !('sheetName' in value) ||
    !('range' in value)
  )
    return;
  if (
    typeof value.sheetId !== 'string' ||
    !value.sheetId ||
    typeof value.sheetName !== 'string' ||
    typeof value.range !== 'string'
  )
    return;
  const addresses = value.range.split(':');
  if (
    addresses.length > 2 ||
    !addresses.every(
      (address) =>
        /^[A-Z]+[1-9]\d*$/.test(address) && positionFromAddress(address)
    )
  )
    return;
  return {
    sheetId: value.sheetId,
    sheetName: value.sheetName,
    range: value.range,
  };
}
