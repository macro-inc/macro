import { describe, expect, it } from 'vitest';
import { spreadsheetCursors } from './spreadsheet-presence';

const peer = (peerId: string, color = 'blue') => ({
  peerId,
  color,
  userId: 'macro|alice@example.com',
  selection: { anchor: 'B2', focus: 'D4' },
});
describe('spreadsheet cursors', () => {
  it('keeps a range compact and resolves a readable name', () => {
    expect(spreadsheetCursors([peer('1')], 200)).toEqual([
      {
        peerId: '1',
        name: 'alice',
        color: 'var(--color-blue)',
        selection: {
          anchor: { row: 1, column: 1 },
          focus: { row: 3, column: 3 },
        },
      },
    ]);
  });
  it('gives colliding peers distinct theme colors regardless of arrival order', () => {
    const peers = [peer('2'), peer('1')];
    const cursors = spreadsheetCursors(peers, 200);
    expect(new Set(cursors.map((cursor) => cursor.color)).size).toBe(2);
    expect(spreadsheetCursors(peers.reverse(), 200)).toEqual(cursors);
  });
  it('ignores invalid or out-of-sheet ranges and uses a resolved display name', () => {
    expect(
      spreadsheetCursors(
        [{ ...peer('1'), selection: { anchor: 'A999', focus: 'A999' } }],
        200
      )
    ).toEqual([]);
    expect(
      spreadsheetCursors([{ ...peer('1'), name: 'Alice Smith' }], 200)[0].name
    ).toBe('Alice Smith');
  });
});
