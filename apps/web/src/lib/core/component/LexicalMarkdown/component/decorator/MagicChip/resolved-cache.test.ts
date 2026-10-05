import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearResolvedMagicChipMemory,
  flushResolvedMagicChips,
  peekResolvedMagicChip,
  type ResolvedMagicChip,
  readResolvedMagicChip,
  rememberResolvedMagicChip,
  resetResolvedMagicChips,
} from './resolved-cache';

const entry: ResolvedMagicChip = {
  agentSessionId: 'session',
  turn: 0,
  markdown: 'Hi!',
};

describe('resolved magic chip cache', () => {
  beforeEach(async () => {
    await resetResolvedMagicChips();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves a remembered passage from memory before IndexedDB flushes', () => {
    rememberResolvedMagicChip(entry);
    expect(peekResolvedMagicChip('session', 0)).toEqual(entry);
  });

  it('reads a flushed passage back after the hot tier is dropped', async () => {
    rememberResolvedMagicChip(entry);
    await flushResolvedMagicChips();
    clearResolvedMagicChipMemory();
    expect(peekResolvedMagicChip('session', 0)).toBeUndefined();

    await expect(readResolvedMagicChip('session', 0)).resolves.toEqual(entry);
    expect(peekResolvedMagicChip('session', 0)).toEqual(entry);
  });

  it('does not write the same passage twice', async () => {
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    rememberResolvedMagicChip(entry);
    await flushResolvedMagicChips();
    rememberResolvedMagicChip(entry);
    await flushResolvedMagicChips();
    expect(put).toHaveBeenCalledOnce();
  });

  it('ignores a passage that has not resolved to prose', () => {
    rememberResolvedMagicChip({ ...entry, markdown: '' });
    rememberResolvedMagicChip({ ...entry, markdown: '   ' });
    rememberResolvedMagicChip({ ...entry, turn: -1 });
    expect(peekResolvedMagicChip('session', 0)).toBeUndefined();
    expect(peekResolvedMagicChip('session', -1)).toBeUndefined();
  });

  it('treats a malformed row as a miss', async () => {
    rememberResolvedMagicChip(entry);
    await flushResolvedMagicChips();
    const database = await openTestDatabase();
    await replaceRow('session:0', { markdown: '' }, database);
    clearResolvedMagicChipMemory();

    await expect(readResolvedMagicChip('session', 0)).resolves.toBeUndefined();
  });

  it('folds through a storage read failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new Error('idb exploded');
    });

    await expect(readResolvedMagicChip('session', 0)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

function openTestDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('macro-magic-chip-resolved', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function replaceRow(
  id: string,
  value: unknown,
  database: IDBDatabase
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('chips', 'readwrite');
    transaction.objectStore('chips').put(value, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
