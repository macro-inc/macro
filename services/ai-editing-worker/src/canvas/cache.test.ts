import { createScene } from '@macro-inc/graphics';
import { describe, expect, it, vi } from 'vitest';
import { CanvasCache } from './cache';
import { canvasRevision } from './revision';

describe('exact scoped renderer caches', () => {
  it('bounds memory/count, isolates exact keys and clones results', () => {
    const cache = new CanvasCache<{ text: string }>(2, 400, 1000);
    cache.set('doc-a:revision-1:crop-a', { text: 'a' });
    cache.set('doc-b:revision-1:crop-a', { text: 'b' });
    cache.get('doc-a:revision-1:crop-a')!.text = 'mutated';
    expect(cache.get('doc-a:revision-1:crop-a')).toEqual({ text: 'a' });
    expect(cache.get('doc-a:revision-2:crop-a')).toBeUndefined();
    expect(cache.get('doc-a:revision-1:crop-b')).toBeUndefined();
    cache.set('doc-c', { text: 'c' });
    expect(cache.get('doc-b:revision-1:crop-a')).toBeUndefined();
    cache.set('too-large', { text: 'x'.repeat(500) });
    expect(cache.get('too-large')).toBeUndefined();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1001);
    try {
      expect(cache.get('doc-c')).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('revisions ignore replica map insertion order and invalidate actual changes', async () => {
    const document = createScene();
    const left = { document, clock: { a: 1, b: 2 } };
    const right = {
      document: { items: document.items, rootId: document.rootId },
      clock: { b: 2, a: 1 },
    };
    expect(await canvasRevision(left)).toBe(await canvasRevision(right));
    expect(await canvasRevision(left)).not.toBe(
      await canvasRevision({ ...left, clock: { a: 2, b: 2 } })
    );
  });
});
