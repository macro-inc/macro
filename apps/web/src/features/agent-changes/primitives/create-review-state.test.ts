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
  it('collapses and reopens an individual file', () => {
    createRoot((dispose) => {
      const { review } = setup();
      expect(review.isCollapsed('a.ts')).toBe(false);
      review.toggleCollapsed('a.ts');
      expect(review.isCollapsed('a.ts')).toBe(true);
      review.toggleCollapsed('a.ts');
      expect(review.isCollapsed('a.ts')).toBe(false);
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

  it('expands files for a new capture but keeps notes', () => {
    createRoot((dispose) => {
      const { review, setCurrent } = setup();
      review.toggleCollapsed('a.ts');
      review.addNote(
        { path: 'a.ts', side: 'additions', lineNumber: 3, endLineNumber: 3 },
        'Rename'
      );
      setCurrent(changeset('cs2', ['a.ts', 'b.ts', 'c.ts']));
      expect(review.isCollapsed('a.ts')).toBe(false);
      expect(review.anyExpanded()).toBe(true);
      expect(review.notes()).toHaveLength(1);
      review.toggleCollapsed('c.ts');
      expect(review.isCollapsed('c.ts')).toBe(true);
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

      review.updateNote('n1', 'Extract a helper, please');
      expect(review.notes()[0]?.text).toBe('Extract a helper, please');

      review.removeNote('n2');
      const sent = review.markQueuedSent();
      expect(sent.map((note) => note.id)).toEqual(['n1']);
      expect(review.queued()).toEqual([]);
      expect(review.notes()[0]?.sentAt).toBe('T');
      expect(review.notes()[0]?.text).toBe('Extract a helper, please');
      review.updateNote('n1', 'ignored after send');
      expect(review.notes()[0]?.text).toBe('Extract a helper, please');
      expect(review.markQueuedSent()).toEqual([]);
      dispose();
    });
  });
});
