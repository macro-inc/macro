import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({ open: new Map<string, number>() }));

vi.mock('./AgentSession', () => ({
  AgentSession: {
    acquire: (id: string) => {
      sessions.open.set(id, (sessions.open.get(id) ?? 0) + 1);
      return {
        release: () => {
          const references = (sessions.open.get(id) ?? 0) - 1;
          if (references > 0) sessions.open.set(id, references);
          else sessions.open.delete(id);
        },
      };
    },
  },
}));

// A fresh module per test, so no test inherits another's held sessions.
let retainRecentlyViewed: (id: string) => void;
beforeEach(async () => {
  vi.resetModules();
  sessions.open.clear();
  ({ retainRecentlyViewed } = await import('./recently-viewed'));
});

describe('retainRecentlyViewed', () => {
  it('holds one acquisition per session however often it is viewed', () => {
    retainRecentlyViewed('a');
    retainRecentlyViewed('a');

    expect(sessions.open.get('a')).toBe(1);
  });

  it('closes the least recently viewed session past eight', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      retainRecentlyViewed(id);
    }
    // Viewing `a` again makes `b` the oldest.
    retainRecentlyViewed('a');
    retainRecentlyViewed('i');

    expect([...sessions.open.keys()].sort()).toEqual([
      'a',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
    ]);
  });
});
