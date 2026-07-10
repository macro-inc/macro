import { describe, expect, it } from 'vitest';
import { ViewerBoundPreloadCache } from './viewer-bound-preload-cache';

describe('ViewerBoundPreloadCache', () => {
  it('never returns entries to a different viewer', () => {
    const cache = new ViewerBoundPreloadCache<string>(2);
    cache.set('viewer-a', 'thread', 'private body');

    expect(cache.get('viewer-b', 'thread')).toBeUndefined();
  });

  it('clears the prior viewer when the active viewer changes', () => {
    const cache = new ViewerBoundPreloadCache<string>(2);
    cache.set('viewer-a', 'thread-a', 'body a');
    cache.set('viewer-b', 'thread-b', 'body b');

    expect(cache.get('viewer-a', 'thread-a')).toBeUndefined();
    expect(cache.get('viewer-b', 'thread-b')).toBe('body b');
  });

  it('evicts stale entries when a newer response omits content', () => {
    const cache = new ViewerBoundPreloadCache<string>(2);
    cache.set('viewer', 'thread', 'old body');
    cache.set('viewer', 'thread', undefined);

    expect(cache.get('viewer', 'thread')).toBeUndefined();
  });

  it('bounds retained content', () => {
    const cache = new ViewerBoundPreloadCache<string>(2);
    cache.set('viewer', 'one', '1');
    cache.set('viewer', 'two', '2');
    cache.set('viewer', 'three', '3');

    expect(cache.get('viewer', 'one')).toBeUndefined();
    expect(cache.get('viewer', 'two')).toBe('2');
    expect(cache.get('viewer', 'three')).toBe('3');
  });
});
