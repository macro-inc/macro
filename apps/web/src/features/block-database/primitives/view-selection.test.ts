import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createDatabaseViewSelection } from './view-selection';

it('restores and saves the selected view when identity arrives after mounting', () => {
  createRoot((dispose) => {
    const [userId, setUserId] = createSignal<string>();
    const values = new Map([
      ['wolf', '{"tableId":"deals","views":{"deals":"board"}}'],
      ['alex', '{"tableId":"contacts","views":{}}'],
    ]);
    const [selection, select] = createDatabaseViewSelection(userId, {
      read: (id) => values.get(id) ?? null,
      write: (id, value) => values.set(id, value),
    });
    expect(selection()).toEqual({ views: {} });
    setUserId('wolf');
    expect(selection()).toEqual({
      tableId: 'deals',
      views: { deals: 'board' },
    });
    select((current) => ({ ...current, tableId: 'contacts' }));
    expect(values.get('wolf')).toBe(
      '{"tableId":"contacts","views":{"deals":"board"}}'
    );
    setUserId('alex');
    expect(selection()).toEqual({ tableId: 'contacts', views: {} });
    expect(values.get('wolf')).toBe(
      '{"tableId":"contacts","views":{"deals":"board"}}'
    );
    dispose();
  });
});
