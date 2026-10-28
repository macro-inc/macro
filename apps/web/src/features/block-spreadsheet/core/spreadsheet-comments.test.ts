import { expect, it } from 'vitest';
import { spreadsheetCommentAnchor } from './spreadsheet-comments';

it('reads only typed spreadsheet message anchors', () => {
  const anchor = { sheetId: 'sheet-1', sheetName: 'Budget', range: 'B4:C9' };
  expect(spreadsheetCommentAnchor({ type: 'spreadsheet', ...anchor })).toEqual(
    anchor
  );
  for (const value of [
    null,
    { spreadsheet: anchor },
    { type: 'markdown' },
    { type: 'spreadsheet', ...anchor, range: 'A0' },
    { type: 'spreadsheet', ...anchor, range: 'A1:B2:C3' },
  ]) {
    expect(spreadsheetCommentAnchor(value)).toBeUndefined();
  }
});
