import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({
  open: new Map<string, number>(),
  purposes: [] as string[],
}));

vi.mock('./AgentSession', () => ({
  AgentSession: {
    get: (id: string) => (sessions.open.has(id) ? {} : undefined),
    acquire: (id: string, purpose: string) => {
      sessions.purposes.push(purpose);
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
let prefetch: typeof import('./prefetch');
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  sessions.open.clear();
  sessions.purposes.length = 0;
  prefetch = await import('./prefetch');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('prefetchAgentSession', () => {
  it('opens the session as a prefetch, once however often it is asked', () => {
    prefetch.prefetchAgentSession('a');
    prefetch.prefetchAgentSession('a');

    expect(sessions.open.get('a')).toBe(1);
    expect(sessions.purposes).toEqual(['prefetch']);
  });

  it('leaves a session that is already open alone', () => {
    sessions.open.set('a', 1);

    prefetch.prefetchAgentSession('a');

    expect(sessions.open.get('a')).toBe(1);
    expect(sessions.purposes).toEqual([]);
  });

  it('lets go of a session nobody opened after thirty seconds from the last ask', () => {
    prefetch.prefetchAgentSession('a');
    vi.advanceTimersByTime(20_000);
    prefetch.prefetchAgentSession('a');
    vi.advanceTimersByTime(20_000);
    expect(sessions.open.has('a')).toBe(true);

    vi.advanceTimersByTime(10_000);
    expect(sessions.open.has('a')).toBe(false);
  });

  it('holds at most four, letting go of the least recently asked for first', () => {
    for (const id of ['a', 'b', 'c', 'd']) prefetch.prefetchAgentSession(id);
    prefetch.prefetchAgentSession('a');
    prefetch.prefetchAgentSession('e');

    expect([...sessions.open.keys()].sort()).toEqual(['a', 'c', 'd', 'e']);
  });

  it('lets go at once when told to forget', () => {
    prefetch.prefetchAgentSession('a');
    prefetch.forgetPrefetchedAgentSession('a');

    expect(sessions.open.has('a')).toBe(false);
    vi.runAllTimers();
    expect(sessions.open.has('a')).toBe(false);
  });
});

describe('prefetchOnIntent', () => {
  const pointer = (pointerType: string) =>
    ({ pointerType }) as unknown as PointerEvent;

  it('prefetches after the pointer rests on the row, not when it passes over', () => {
    const intent = prefetch.prefetchOnIntent(() => 'a');
    intent.onPointerEnter(pointer('mouse'));
    vi.advanceTimersByTime(50);
    intent.onPointerLeave();
    vi.advanceTimersByTime(500);
    expect(sessions.open.has('a')).toBe(false);

    intent.onPointerEnter(pointer('mouse'));
    vi.advanceTimersByTime(100);
    expect(sessions.open.has('a')).toBe(true);
  });

  it('prefetches at once on keyboard focus', () => {
    prefetch.prefetchOnIntent(() => 'a').onFocus();

    expect([...sessions.open.keys()]).toEqual(['a']);
  });

  it('ignores the hover a touch synthesizes', () => {
    prefetch.prefetchOnIntent(() => 'a').onPointerEnter(pointer('touch'));
    vi.advanceTimersByTime(500);

    expect(sessions.open.has('a')).toBe(false);
  });
});
