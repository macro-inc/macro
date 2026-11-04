import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';
import { createInboxSelection } from './inbox-selection';

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
    entityAt: () => ({}) as never,
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

describe('createInboxSelection', () => {
  it('shows a stack at one of its notifications until another is chosen', () => {
    createRoot((dispose) => {
      const selection = createInboxSelection(() => [stack('a', ['1', '2'])]);

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
      const selection = createInboxSelection(rows);
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
      const selection = createInboxSelection(rows);
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
      const selection = createInboxSelection(() => [row('a')]);
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
      const selection = createInboxSelection(rows);
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
});
