import { batch, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import {
  createDatabaseViewSelection,
  followLinkedLocation,
} from './view-selection';

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

it('opens the table and view a link names, keeping other remembered views', () => {
  const [tableId, setTableId] = createSignal<string>();
  const [viewId, setViewId] = createSignal<string>();
  const [selection, select] = createSignal({
    tableId: 'table-1',
    views: { 'table-1': 'grid', activities: 'list' } as Record<string, string>,
  });
  const dispose = createRoot((dispose) => {
    followLinkedLocation({ tableId, viewId }, select);
    return dispose;
  });
  expect(selection().tableId).toBe('table-1');
  batch(() => {
    setTableId('activities');
    setViewId('timeline');
  });
  expect(selection()).toEqual({
    tableId: 'activities',
    views: { 'table-1': 'grid', activities: 'timeline' },
  });
  batch(() => {
    setTableId('table-1');
    setViewId(undefined);
  });
  expect(selection()).toEqual({
    tableId: 'table-1',
    views: { 'table-1': 'grid', activities: 'timeline' },
  });
  dispose();
});
