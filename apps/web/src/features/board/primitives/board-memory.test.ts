import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { BoardStorage } from '../context/board-context';
import { createBoardMemory, pruneMemory } from './board-memory';

function memoryStorage(initial?: unknown) {
  const store = { value: initial };
  const storage: BoardStorage = {
    read: () => store.value,
    write: (value) => {
      store.value = value;
    },
  };
  return { store, storage };
}

function withMemory(
  storage: BoardStorage,
  run: (memory: ReturnType<typeof createBoardMemory>) => void
) {
  createRoot((dispose) => {
    run(createBoardMemory(storage));
    dispose();
  });
}

describe('createBoardMemory', () => {
  it('remembers moved items per variant and pins them', () => {
    const { store, storage } = memoryStorage();
    withMemory(storage, (memory) => {
      memory.moveTo('v1a', 'channel:a', { x: 10.4, y: 20.6 });

      expect(memory.position('v1a', 'channel:a')).toEqual({ x: 10, y: 21 });
      expect(memory.position('v1b', 'channel:a')).toBeUndefined();
      expect(memory.recall('channel:a')?.pinned).toBe(true);
      expect(memory.hasMoved('v1a')).toBe(true);
    });

    withMemory(storage, (memory) => {
      expect(memory.position('v1a', 'channel:a')).toEqual({ x: 10, y: 21 });
    });
    expect(store.value).toBeDefined();
  });

  it('closing an item unpins it everywhere and records its activity', () => {
    const { storage } = memoryStorage();
    withMemory(storage, (memory) => {
      memory.moveTo('v1a', 'email:e', { x: 1, y: 2 });
      memory.moveTo('v1c', 'email:e', { x: 3, y: 4 });
      memory.dismiss('email:e', 1234);

      expect(memory.recall('email:e')).toMatchObject({
        dismissedAt: 1234,
        pinned: false,
      });
      expect(memory.position('v1a', 'email:e')).toBeUndefined();
      expect(memory.position('v1c', 'email:e')).toBeUndefined();
    });
  });

  it('tidying a variant only unpins items moved nowhere else', () => {
    const { storage } = memoryStorage();
    withMemory(storage, (memory) => {
      memory.moveTo('v1a', 'a', { x: 1, y: 1 });
      memory.moveTo('v1a', 'b', { x: 2, y: 2 });
      memory.moveTo('v1b', 'b', { x: 3, y: 3 });
      memory.tidy('v1a');

      expect(memory.hasMoved('v1a')).toBe(false);
      expect(memory.recall('a')?.pinned).toBe(false);
      expect(memory.recall('b')?.pinned).toBe(true);
    });
  });

  it('forgets a variant camera to fall back to fitting', () => {
    const { storage } = memoryStorage();
    withMemory(storage, (memory) => {
      memory.setCamera('v1d', { x: 1, y: 2, scale: 0.5 });
      expect(memory.camera('v1d')).toEqual({ x: 1, y: 2, scale: 0.5 });
      memory.setCamera('v1d', undefined);
      expect(memory.camera('v1d')).toBeUndefined();
    });
  });

  it('starts empty from unreadable storage', () => {
    const { storage } = memoryStorage({ version: 9, recall: 'nope' });
    withMemory(storage, (memory) => {
      expect(memory.showSettled()).toBe(false);
      expect(memory.recall('anything')).toBeUndefined();
    });
  });
});

describe('pruneMemory', () => {
  it('keeps positions only for pinned items', () => {
    const pruned = pruneMemory({
      version: 1,
      recall: { a: { pinned: true }, b: { seenAt: 5 } },
      positions: { v1a: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } } },
      cameras: {},
      showSettled: false,
    });

    expect(Object.keys(pruned.positions.v1a)).toEqual(['a']);
  });

  it('keeps items moved by hand when the newest recall fills the memory', () => {
    const recall = Object.fromEntries(
      Array.from({ length: 450 }, (_, index) => [
        `seen-${index}`,
        { seenAt: index + 1 },
      ])
    );
    const pruned = pruneMemory({
      version: 1,
      recall: { ...recall, moved: { pinned: true } },
      positions: { v1a: { moved: { x: 10, y: 20 } } },
      cameras: {},
      showSettled: false,
    });

    expect(Object.keys(pruned.recall)).toHaveLength(400);
    expect(pruned.recall.moved).toEqual({ pinned: true });
    expect(pruned.positions.v1a.moved).toEqual({ x: 10, y: 20 });
  });
});
