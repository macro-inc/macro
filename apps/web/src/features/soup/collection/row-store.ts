import { type Accessor, createComputed, createMemo } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Deep copy of plain objects and arrays. Reads through Solid store proxies. */
function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.map(snapshot) as T;
  if (value === null || typeof value !== 'object' || !isPlainObject(value)) {
    return value;
  }
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) copy[key] = snapshot(value[key]);
  return copy as T;
}

/**
 * Keeps list rows in a Solid store reconciled by row id, like next-soup's row
 * store. A row keeps its object across rebuilds and its entity's fields change
 * in place, so a virtualized list (which keys rows by reference) re-renders
 * only the values that changed instead of remounting every row.
 *
 * Rows are copied before reconciling. Query results are themselves stores
 * that update in place, and a list can switch between server pages and local
 * cache results; reconciling their objects directly would make this store
 * write one source's values into objects another store owns. Reading the copy
 * also tracks nested fields, so in-place query updates reach the rows.
 */
export function createSoupRowStore<TRow extends { id: string }>(
  rows: Accessor<TRow[]>
): Accessor<TRow[]> {
  const [store, setStore] = createStore<TRow[]>([]);
  createComputed(() => {
    const next = snapshot(rows());
    setStore(reconcile(next, { key: 'id', merge: true }));
  });
  // A new array only for structural changes; row proxies update in place.
  return createMemo(() => [...store]);
}
