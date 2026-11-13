import { batch, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import {
  createDatabaseViewSelection,
  followRouteLocation,
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

it('opens the table and view the route names, again once the viewer is known', () => {
  const [tableId, setTableId] = createSignal('');
  const [viewId, setViewId] = createSignal('');
  const [userId, setUserId] = createSignal<string>();
  const values = new Map([
    ['wolf', '{"tableId":"table-1","views":{"table-1":"grid"}}'],
  ]);
  const { selection, dispose } = createRoot((dispose) => {
    const [selection, select] = createDatabaseViewSelection(userId, {
      read: (id) => values.get(id) ?? null,
      write: (id, value) => values.set(id, value),
    });
    followRouteLocation({ tableId, viewId }, userId, select);
    return { selection, dispose };
  });
  batch(() => {
    setTableId('activities');
    setViewId('timeline');
  });
  expect(selection().tableId).toBe('activities');
  setUserId('wolf');
  expect(selection()).toEqual({
    tableId: 'activities',
    views: { 'table-1': 'grid', activities: 'timeline' },
  });
  batch(() => {
    setTableId('table-1');
    setViewId('');
  });
  expect(selection()).toEqual({
    tableId: 'table-1',
    views: { 'table-1': 'grid', activities: 'timeline' },
  });
  dispose();
});
