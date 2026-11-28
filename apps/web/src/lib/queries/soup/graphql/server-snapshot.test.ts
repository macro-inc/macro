import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { expect, it } from 'vitest';
import { serverSnapshot, shareServerRows } from './server-snapshot';

const row = (id: string, name = id) => ({
  __typename: 'GraphqlSoupDocument',
  id,
  name,
  tags: [{ id: `${id}-tag` }],
});

it('copies an uncached store result and keeps every row a change in place left alone', () => {
  createRoot((dispose) => {
    const [store, setStore] = createStore({
      items: [row('a'), row('b'), row('c')],
    });
    const first = serverSnapshot(store);
    expect(first).toEqual({ items: [row('a'), row('b'), row('c')] });
    expect(first).not.toBe(store);
    setStore('items', 1, 'name', 'renamed');
    const second = shareServerRows(serverSnapshot(store), first);
    expect(second.items[0]).toBe(first.items[0]);
    expect(second.items[2]).toBe(first.items[2]);
    expect(second.items[1]).not.toBe(first.items[1]);
    expect(second.items[1]).toEqual(row('b', 'renamed'));
    expect(shareServerRows(serverSnapshot(store), second)).toBe(second);
    dispose();
  });
});

it('returns a plain value as it is', () => {
  const value = { items: [row('a')] };
  expect(serverSnapshot(value)).toBe(value);
  expect(shareServerRows(value, undefined)).toBe(value);
});
