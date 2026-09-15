import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { Changeset } from '../core/changeset';
import { createReviewState } from './create-review-state';

function changeset(id: string, paths: string[]): Changeset {
  return {
    id,
    base: { name: 'main' },
    head: { name: 'agent/x' },
    files: paths.map((path) => ({
      path,
      kind: 'modified',
      additions: 1,
      deletions: 0,
      binary: false,
      patchOmitted: false,
    })),
    additions: paths.length,
    deletions: 0,
    patchBytes: 1,
    truncated: false,
    capturedAt: 't',
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function setup() {
  const [current, setCurrent] = createSignal<Changeset | undefined>(
    changeset('cs1', ['a.ts', 'b.ts'])
  );
  const review = createReviewState({
    sessionId: () => 's1',
    changeset: current,
    storage: memoryStorage(),
    now: () => 'T',
    newId: (() => {
      let n = 0;
      return () => `n${++n}`;
    })(),
  });
  return { review, setCurrent };
}

describe('createReviewState', () => {
  it('folds a viewed file and tracks progress', () => {
    createRoot((dispose) => {
      const { review } = setup();
      expect(review.progress()).toEqual({ viewed: 0, total: 2 });
      review.toggleViewed('a.ts');
      expect(review.isViewed('a.ts')).toBe(true);
      expect(review.isCollapsed('a.ts')).toBe(true);
      expect(review.progress()).toEqual({ viewed: 1, total: 2 });
      review.toggleViewed('a.ts');
      expect(review.isViewed('a.ts')).toBe(false);
      expect(review.isCollapsed('a.ts')).toBe(false);
      dispose();
    });
  });

  it('marks all, then clears all', () => {
    createRoot((dispose) => {
      const { review } = setup();
      review.toggleAllViewed();
      expect(review.allViewed()).toBe(true);
      expect(review.anyExpanded()).toBe(false);
      review.toggleAllViewed();
      expect(review.progress().viewed).toBe(0);
      expect(review.anyExpanded()).toBe(true);
      dispose();
    });
  });

  it('collapses and expands everything from the bar', () => {
    createRoot((dispose) => {
      const { review } = setup();
      review.toggleAllCollapsed();
      expect(review.anyExpanded()).toBe(false);
      review.toggleAllCollapsed();
      expect(review.anyExpanded()).toBe(true);
      dispose();
    });
  });

  it('starts marks over for a new capture but keeps notes', () => {
    createRoot((dispose) => {
      const { review, setCurrent } = setup();
      review.toggleViewed('a.ts');
      review.addNote(
        { path: 'a.ts', side: 'additions', lineNumber: 3, endLineNumber: 3 },
        'Rename'
      );
      setCurrent(changeset('cs2', ['a.ts', 'b.ts', 'c.ts']));
      expect(review.isViewed('a.ts')).toBe(false);
      expect(review.progress()).toEqual({ viewed: 0, total: 3 });
      expect(review.notes()).toHaveLength(1);
      review.toggleViewed('c.ts');
      expect(review.isViewed('c.ts')).toBe(true);
      dispose();
    });
  });

  it('activating a file uncollapses it and points the stack at it', () => {
    createRoot((dispose) => {
      const { review } = setup();
      review.toggleCollapsed('b.ts');
      review.activate('b.ts');
      expect(review.active()).toBe('b.ts');
      expect(review.isCollapsed('b.ts')).toBe(false);
      dispose();
    });
  });

  it('queues, sends, and removes notes', () => {
    createRoot((dispose) => {
      const { review } = setup();
      const anchor = {
        path: 'a.ts',
        side: 'additions' as const,
        lineNumber: 10,
        endLineNumber: 12,
      };
      review.openNote(anchor);
      expect(review.composing()).toEqual(anchor);
      review.addNote(anchor, '   ');
      expect(review.composing()).toBeUndefined();
      expect(review.notes()).toHaveLength(0);

      review.addNote(anchor, 'Extract a helper');
      review.addNote({ ...anchor, path: 'b.ts' }, 'Keep');
      expect(review.queued().map((note) => note.id)).toEqual(['n1', 'n2']);

      review.removeNote('n2');
      const sent = review.markQueuedSent();
      expect(sent.map((note) => note.id)).toEqual(['n1']);
      expect(review.queued()).toEqual([]);
      expect(review.notes()[0]?.sentAt).toBe('T');
      expect(review.markQueuedSent()).toEqual([]);
      dispose();
    });
  });
});
