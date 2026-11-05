import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import {
  createInboxSelection,
  type InboxShownRow,
  type InboxShownRowLocation,
} from './inbox-selection';

const row = (id: string, revision = 'r1'): NotificationInboxRow => ({
  id,
  type: 'task',
  revision,
  latestAt: 1,
  actions: [],
  unseen: true,
  count: 1,
  content: {
    entity: { type: 'document', id, name: id } as never,
    notifications: [],
  },
});

const stack = (
  id: string,
  notificationIds: string[]
): NotificationInboxRow => ({
  ...row(id),
  count: notificationIds.length,
  content: {
    ...row(id).content,
    notifications: notificationIds.map(
      (notification) => ({ id: notification }) as never
    ),
  },
});

/** A URL stand-in that records each write as a history entry. */
const memoryLocation = (initial: InboxShownRow = { row: '', item: '' }) => {
  const [shown, setShown] = createSignal(initial);
  const writes: { next: InboxShownRow; replace: boolean }[] = [];
  const location: InboxShownRowLocation = {
    shown,
    show: (next, { replace }) => {
      writes.push({ next, replace });
      setShown(next);
    },
  };
  return { location, writes };
};

describe('createInboxSelection', () => {
  it('shows a stack at one of its notifications until another is chosen', () => {
    createRoot((dispose) => {
      const selection = createInboxSelection(
        () => [stack('a', ['1', '2'])],
        memoryLocation().location
      );

      selection.select(stack('a', ['1', '2']), '2');
      expect(selection.selectedNotification()?.id).toBe('2');
      expect(selection.navigationRequest()).toBe(0);

      selection.select(stack('a', ['1', '2']), '2');
      expect(selection.navigationRequest()).toBe(1);

      selection.select(stack('a', ['1', '2']));
      expect(selection.selectedNotification()).toBeUndefined();
      expect(selection.navigationRequest()).toBe(1);
      dispose();
    });
  });

  it('opens where the row does once the chosen notification leaves the row', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal([stack('a', ['1', '2'])]);
      const selection = createInboxSelection(rows, memoryLocation().location);
      selection.select(stack('a', ['1', '2']), '1');

      setRows([stack('a', ['3', '2'])]);
      expect(selection.selected()?.id).toBe('a');
      expect(selection.selectedNotification()).toBeUndefined();
      dispose();
    });
  });

  it('follows the shown row and keeps it once it leaves the list', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal([row('a'), row('b')]);
      const selection = createInboxSelection(rows, memoryLocation().location);
      selection.select(row('a'));

      setRows([row('a', 'r2'), row('b')]);
      expect(selection.selected()?.revision).toBe('r2');

      setRows([row('b')]);
      expect(selection.selected()?.id).toBe('a');
      dispose();
    });
  });

  it('re-aims when the shown row is chosen again', () => {
    createRoot((dispose) => {
      const selection = createInboxSelection(
        () => [row('a')],
        memoryLocation().location
      );
      selection.select(row('a'));
      expect(selection.navigationRequest()).toBe(0);
      selection.select(row('a'));
      expect(selection.navigationRequest()).toBe(1);
      dispose();
    });
  });

  it('moves to the next row that stays when the shown row leaves', () => {
    createRoot((dispose) => {
      const rows = () => [row('a'), row('b'), row('c'), row('d')];
      const selection = createInboxSelection(rows, memoryLocation().location);
      selection.select(row('b'));

      expect(selection.afterLeaving(['c'])).toBe('stay');
      expect(selection.afterLeaving(['b', 'c'])).toMatchObject({ id: 'd' });
      expect(selection.afterLeaving(['b', 'c', 'd'])).toMatchObject({
        id: 'a',
      });
      expect(selection.afterLeaving(['a', 'b', 'c', 'd'])).toBe('none');
      dispose();
    });
  });

  it('adds a history entry for each row shown, unless told to replace', () => {
    createRoot((dispose) => {
      const { location, writes } = memoryLocation();
      const selection = createInboxSelection(
        () => [stack('a', ['1', '2']), row('b')],
        location
      );

      selection.select(stack('a', ['1', '2']), '2');
      selection.select(row('b'), undefined, { replace: true });
      selection.select(row('b'));
      selection.clear();

      expect(writes).toEqual([
        { next: { row: 'a', item: '2' }, replace: false },
        { next: { row: 'b', item: '' }, replace: true },
        { next: { row: '', item: '' }, replace: false },
      ]);
      expect(selection.selected()).toBeUndefined();
      dispose();
    });
  });

  it('shows the row the location names once the list loads it', () => {
    createRoot((dispose) => {
      const [rows, setRows] = createSignal<NotificationInboxRow[]>([]);
      const { location } = memoryLocation({ row: 'b', item: '2' });
      const selection = createInboxSelection(rows, location);
      expect(selection.selected()).toBeUndefined();

      setRows([row('a'), stack('b', ['1', '2'])]);
      expect(selection.selected()?.id).toBe('b');
      expect(selection.selectedNotification()?.id).toBe('2');
      dispose();
    });
  });
});
