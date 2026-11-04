import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import {
  createInboxListItems,
  dateHeaderLabel,
  type InboxListItem,
  isInboxRow,
} from './inbox-date-headers';

const NOW = new Date(2026, 8, 14, 20, 0);

const row = (id: string, latestAt: Date): NotificationInboxRow => ({
  id,
  type: 'task',
  revision: `rev-${id}`,
  latestAt: latestAt.getTime(),
  actions: [],
  unseen: true,
  count: 1,
  content: {
    entity: { type: 'document', id, name: 'Plan' } as never,
    notifications: [],
  },
});

const todayAt = (hour: number, minute = 0) =>
  new Date(2026, 8, 14, hour, minute);

/** Headers by label and rows by id, in list order. */
const shape = (items: readonly InboxListItem[]) =>
  items.map((item) => (isInboxRow(item) ? item.id : dateHeaderLabel(item)));

describe('createInboxListItems', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('puts a divider above the first row of each section', () => {
    createRoot((dispose) => {
      const items = createInboxListItems(() => [
        row('a', todayAt(19, 58)),
        row('b', todayAt(19, 57)),
        row('c', todayAt(19, 30)),
        row('d', todayAt(13)),
        row('e', todayAt(8)),
        row('f', new Date(2026, 8, 13, 12)),
        row('g', new Date(2026, 8, 10, 12)),
        row('h', new Date(2026, 8, 2, 12)),
        row('i', new Date(2026, 7, 20, 12)),
        row('j', new Date(2026, 5, 1, 12)),
      ]);
      expect(shape(items())).toEqual([
        'Last few minutes',
        'a',
        'b',
        'Last hour',
        'c',
        'This afternoon',
        'd',
        'This morning',
        'e',
        'Yesterday',
        'f',
        'Last 7 days',
        'g',
        'Earlier this month',
        'h',
        'Last month',
        'i',
        'Older',
        'j',
      ]);
      dispose();
    });
  });

  it('shows no divider for a section with no rows', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal<NotificationInboxRow[]>([
        row('a', todayAt(19, 58)),
        row('b', todayAt(13)),
      ]);
      const items = createInboxListItems(rows);
      expect(shape(items())).toEqual([
        'Last few minutes',
        'a',
        'This afternoon',
        'b',
      ]);

      setRows([row('b', todayAt(13))]);
      expect(shape(items())).toEqual(['This afternoon', 'b']);

      setRows([]);
      expect(items()).toEqual([]);
      dispose();
    });
  });

  it('keeps its objects as the clock ticks, and moves rows between sections', () => {
    const { items, dispose, recent } = createRoot((dispose) => {
      const recent = row('a', todayAt(19, 58));
      const items = createInboxListItems(() => [recent]);
      return { items, dispose, recent };
    });
    const before = items();
    expect(shape(before)).toEqual(['Last few minutes', 'a']);

    vi.advanceTimersByTime(60_000);
    const after = items();
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(recent);

    vi.advanceTimersByTime(4 * 60_000);
    expect(shape(items())).toEqual(['Last hour', 'a']);
    expect(items()[1]).toBe(recent);
    dispose();
  });
});
