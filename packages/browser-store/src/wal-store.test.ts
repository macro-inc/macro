import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWALStore, InMemoryWALStore, type WALStore } from './wal-store';

let run = 0;
let dbName: string;
beforeEach(() => {
  dbName = `wal-test-${++run}`;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const HOUR_MS = 60 * 60 * 1000;

describe.each([
  [
    'BrowserWALStore',
    (scope: string) => new BrowserWALStore<number>(dbName, scope),
  ],
  ['InMemoryWALStore', () => new InMemoryWALStore<number>()],
])('%s', (_name, open: (scope: string) => WALStore<number>) => {
  it('appends in order with distinct ids', async () => {
    const store = open('a');
    await store.append(1);
    await store.append(2);
    const entries = await store.getAll();
    expect(entries.map((entry) => entry.update)).toEqual([1, 2]);
    expect(entries.map((entry) => entry.delivered)).toEqual([false, false]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
    expect(await store.count()).toBe(2);
  });

  it('keeps delivered entries until pruned', async () => {
    const store = open('a');
    await store.append(1);
    await store.append(2);
    const [first] = await store.getAll();
    await store.markDelivered([first!.id]);
    expect((await store.getAll()).map((entry) => entry.delivered)).toEqual([
      true,
      false,
    ]);
    await store.pruneDelivered();
    expect((await store.getAll()).map((entry) => entry.update)).toEqual([2]);
  });

  it('expires only undelivered entries past the ttl', async () => {
    const start = Date.parse('2026-01-01T00:00:00Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    const store = open('a');
    await store.append(1);
    await store.append(2);
    const [first] = await store.getAll();
    await store.markDelivered([first!.id]);
    now.mockReturnValue(start + 2 * HOUR_MS);
    await store.append(3);
    expect(await store.pruneExpired(HOUR_MS)).toBe(1);
    expect((await store.getAll()).map((entry) => entry.update)).toEqual([1, 3]);
  });
});

describe('BrowserWALStore', () => {
  it('scopes entries and lists the scopes that have any', async () => {
    const a = new BrowserWALStore<number>(dbName, 'a');
    const b = new BrowserWALStore<number>(dbName, 'b');
    await a.append(1);
    await b.append(2);
    await b.append(3);
    expect((await a.getAll()).map((entry) => entry.update)).toEqual([1]);
    expect(await b.count()).toBe(2);
    expect((await BrowserWALStore.listScopeIds(dbName)).sort()).toEqual([
      'a',
      'b',
    ]);
    await a.markDelivered((await a.getAll()).map((entry) => entry.id));
    await a.pruneDelivered();
    expect(await BrowserWALStore.listScopeIds(dbName)).toEqual(['b']);
  });
});
