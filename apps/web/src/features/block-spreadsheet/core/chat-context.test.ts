import { describe, expect, it } from 'vitest';
import { spreadsheetChatContext } from './chat-context';

const sheet = {
  id: 'sheet-2',
  name: 'Annual budget',
  cells: {},
  layout: { rowCount: 200, columnWidths: {} },
};

describe('spreadsheet chat context', () => {
  it('captures the active sheet and normalizes a reversed range', () => {
    expect(
      spreadsheetChatContext(sheet, {
        anchor: 'E9',
        focus: 'B4',
        sheetId: sheet.id,
      })
    ).toEqual({
      sheetId: 'sheet-2',
      sheetName: 'Annual budget',
      range: 'B4:E9',
    });
  });

  it('uses A1 for a new sheet or stale selection after rows disappear', () => {
    for (const selection of [
      undefined,
      { anchor: 'B4', focus: 'E9', sheetId: 'other' },
      { anchor: 'B201', focus: 'E210', sheetId: sheet.id },
    ]) {
      expect(spreadsheetChatContext(sheet, selection).range).toBe('A1');
    }
  });
});
