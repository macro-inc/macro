import type { NewThreadAnchor } from '@service-storage/generated/schemas/newThreadAnchor';
import type { ThreadAnchor } from '@service-storage/generated/schemas/threadAnchor';
import { positionFromAddress } from './grid-selection';

export const SPREADSHEET_COMMENT_PARAMS = { commentId: 'comment_id' } as const;

export type SpreadsheetCommentAnchor = {
  sheetId: string;
  sheetName: string;
  range: string;
};

/** The thread anchor posted with a root comment on a cell range. */
export function spreadsheetThreadAnchor(
  anchor: SpreadsheetCommentAnchor
): NewThreadAnchor {
  return {
    type: 'spreadsheet',
    sheet_id: anchor.sheetId,
    sheet_name: anchor.sheetName,
    range: anchor.range,
  };
}

/** The cell range a thread is anchored to; absent for workbook comments and other anchors. */
export function spreadsheetCommentAnchor(
  anchor: ThreadAnchor | null | undefined
): SpreadsheetCommentAnchor | undefined {
  if (!anchor || typeof anchor !== 'object' || anchor.type !== 'spreadsheet')
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
