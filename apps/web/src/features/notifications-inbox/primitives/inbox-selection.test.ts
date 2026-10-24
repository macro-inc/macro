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
  },
});

describe('createInboxSelection', () => {
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
