import { describe, expect, it } from 'vitest';
import { boardItem, HOUR, NOW } from '../tests/items';
import { feedDay, feedRows } from './feed';

const DAY = 24 * HOUR;

describe('feedDay', () => {
  it('names the stretch of time activity falls in', () => {
    expect(feedDay(NOW - HOUR, NOW)).toBe('today');
    expect(feedDay(NOW - DAY, NOW)).toBe('yesterday');
    expect(feedDay(NOW - 3 * DAY, NOW)).toBe('week');
    expect(feedDay(NOW - 10 * DAY, NOW)).toBe('older');
  });
});

describe('feedRows', () => {
  it('lists the newest activity first with a heading per stretch of time', () => {
    const rows = feedRows(
      [
        boardItem('old', { lastActivityAt: NOW - 10 * DAY }),
        boardItem('launch', { lastActivityAt: NOW - HOUR }),
        boardItem('design', { lastActivityAt: NOW - 2 * HOUR }),
        boardItem('standup', { lastActivityAt: NOW - DAY }),
      ],
      NOW
    );

    expect(
      rows.map((row) => (row.kind === 'day' ? `# ${row.day}` : row.key))
    ).toEqual([
      '# today',
      'launch',
      'design',
      '# yesterday',
      'standup',
      '# older',
      'old',
    ]);
  });

  it('counts items apart from headings, for keyboard focus', () => {
    const rows = feedRows(
      [
        boardItem('launch', { lastActivityAt: NOW - HOUR }),
        boardItem('standup', { lastActivityAt: NOW - DAY }),
      ],
      NOW
    );

    expect(
      rows.flatMap((row) => (row.kind === 'item' ? [row.index] : []))
    ).toEqual([0, 1]);
  });

  it('lists an item once, at its newest, when the source repeats it', () => {
    const rows = feedRows(
      [
        boardItem('launch', { lastActivityAt: NOW - DAY }),
        boardItem('design', { lastActivityAt: NOW - 2 * HOUR }),
        boardItem('launch', { lastActivityAt: NOW - HOUR }),
      ],
      NOW
    );

    expect(
      rows.flatMap((row) =>
        row.kind === 'item' ? [`${row.key}@${row.index}`] : []
      )
    ).toEqual(['launch@0', 'design@1']);
    expect(rows.filter((row) => row.kind === 'day')).toHaveLength(1);
  });

  it('keeps the source order for activity at the same moment', () => {
    const at = NOW - HOUR;
    const rows = feedRows(
      [
        boardItem('first', { lastActivityAt: at }),
        boardItem('second', { lastActivityAt: at }),
      ],
      NOW
    );

    expect(
      rows.filter((row) => row.kind === 'item').map((row) => row.key)
    ).toEqual(['first', 'second']);
  });
});
