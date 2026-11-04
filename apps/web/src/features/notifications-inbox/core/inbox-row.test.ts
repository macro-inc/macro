import { describe, expect, it } from 'vitest';
import {
  compareInboxRows,
  type InboxRow,
  markRows,
  settleRowMarks,
  unmarkRows,
  withoutDoneRows,
  withSeenRows,
} from './inbox-row';

const row = (
  id: string,
  latestAt: number,
  revision = `rev-${id}`
): InboxRow<null> => ({
  id,
  type: 'channel_messages',
  revision,
  latestAt,
  actions: [],
  unseen: true,
  count: 1,
  content: null,
});

const ids = (rows: InboxRow<null>[]) => rows.map((r) => r.id);

describe('compareInboxRows', () => {
  it('orders rows newest first, breaking ties by id', () => {
    const rows = [row('a#task', 20), row('c#task', 30), row('b#task', 20)];
    expect(ids(rows.sort(compareInboxRows))).toEqual([
      'c#task',
      'b#task',
      'a#task',
    ]);
  });
});

describe('done rows', () => {
  const rows = [row('a#task', 30), row('b#task', 20)];

  it('hides a row only while it shows the acknowledged revision', () => {
    const done = markRows(new Map(), [rows[0]]);
    expect(ids(withoutDoneRows(rows, done))).toEqual(['b#task']);
    // A newer notification changes the revision and shows the row again.
    const newer = [row('a#task', 40, 'rev-newer'), rows[1]];
    expect(ids(withoutDoneRows(newer, done))).toEqual(['a#task', 'b#task']);
  });

  it('shows a row again when its done is undone', () => {
    const done = unmarkRows(markRows(new Map(), rows), ['a#task']);
    expect(ids(withoutDoneRows(rows, done))).toEqual(['a#task']);
  });

  it('forgets rows a fresh read removed or advanced', () => {
    const done = markRows(new Map(), rows);
    const settled = settleRowMarks(done, [row('a#task', 30)]);
    expect([...settled.keys()]).toEqual(['a#task']);
    expect(settleRowMarks(done, [row('a#task', 40, 'rev-newer')]).size).toBe(0);
  });
});

describe('seen rows', () => {
  it('reads a row as seen only while it shows the acknowledged revision', () => {
    const seen = markRows(new Map(), [row('a#task', 30)]);
    expect(
      withSeenRows([row('a#task', 30), row('b#task', 20)], seen).map(
        (r) => r.unseen
      )
    ).toEqual([false, true]);
    // A newer notification changes the revision and reads as unseen again.
    expect(
      withSeenRows([row('a#task', 40, 'rev-newer')], seen).map((r) => r.unseen)
    ).toEqual([true]);
  });
});
