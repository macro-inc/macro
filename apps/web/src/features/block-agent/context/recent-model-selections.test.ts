import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecentModelSelections } from './recent-model-selections';

describe('recent model selections', () => {
  beforeEach(() => localStorage.clear());
  it('keeps multiple in-memory choices when storage is blocked', () => {
    const read = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    try {
      createRoot((dispose) => {
        const store = createRecentModelSelections('user-a');
        store.remember('a');
        store.remember('b');
        expect(store.ids()).toEqual(['b', 'a']);
        dispose();
      });
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
  it('persists five unique model IDs in most-recent order', () => {
    createRoot((dispose) => {
      const store = createRecentModelSelections('user-a');
      for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'c']) store.remember(id);
      expect(store.ids()).toEqual(['c', 'f', 'e', 'd', 'b']);
      expect(createRecentModelSelections('user-a').ids()).toEqual([
        'c',
        'f',
        'e',
        'd',
        'b',
      ]);
      dispose();
    });
  });
  it('isolates accounts and leaves anonymous choices in memory', () => {
    createRoot((dispose) => {
      const first = createRecentModelSelections('user-a');
      first.remember('private-a');
      const second = createRecentModelSelections('user-b');
      expect(second.ids()).toEqual([]);
      second.remember('private-b');
      expect(first.ids()).toEqual(['private-a']);
      const anonymous = createRecentModelSelections(undefined);
      anonymous.remember('temporary');
      expect(createRecentModelSelections(undefined).ids()).toEqual([]);
      dispose();
    });
  });
  it('merges picks made by another mounted composer on refresh', () => {
    createRoot((dispose) => {
      const first = createRecentModelSelections('user-a');
      const second = createRecentModelSelections('user-a');
      first.remember('a');
      second.remember('b');
      first.refresh();
      expect(first.ids()).toEqual(['b', 'a']);
      dispose();
    });
  });
  it('recovers from malformed storage and ignores invalid and duplicate IDs', () => {
    localStorage.setItem('agent-model-recent-v1:user-a', '{bad');
    createRoot((dispose) => {
      const first = createRecentModelSelections('user-a');
      expect(first.ids()).toEqual([]);
      first.remember('valid');
      expect(first.ids()).toEqual(['valid']);
      localStorage.setItem(
        'agent-model-recent-v1:user-a',
        JSON.stringify(['valid', 'valid', null, '', 42, 'other'])
      );
      first.refresh();
      expect(first.ids()).toEqual(['valid', 'other']);
      dispose();
    });
  });
});
