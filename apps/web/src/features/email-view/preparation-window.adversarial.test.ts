/**
 * Property test for the neighbor preparation window: random focus/list/session
 * sequences (duplicates, empty lists, focus on rows that are not emails, rapid
 * changes) must never retain a thread twice, leak a retention, release one
 * twice, or start work for a disabled/disposed window.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmailPreparation } from '../email-message/context/email-preparation';
import { emailThreadId, emailThreadIds } from './preparation-adapter';
import { createPreparationWindow } from './preparation-window';

vi.mock('@app/features/email-thread/preparation-adapter', () => ({
  prepareEmailThreads: vi.fn(),
}));
vi.mock('@app/lib/email-render-cache/session', () => ({
  useEmailRenderCache: () => () => undefined,
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('keeps retention balanced across random navigation', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const random = rng(seed);
    const services: (EmailPreparation | undefined)[] = [
      { acquire: vi.fn() },
      { acquire: vi.fn() },
      undefined,
    ];
    const live = new Map<string, number>();
    const log: string[] = [];
    let releasedTwice = false;
    let disposed = false;
    let startedAfterDispose = false;
    let startedWithoutService = false;
    let current: EmailPreparation | undefined;
    let selection = new Set<string>();
    const window = createPreparationWindow((service, id) => {
      if (disposed) startedAfterDispose = true;
      if (!service || service !== current) startedWithoutService = true;
      const key = id;
      live.set(key, (live.get(key) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) releasedTwice = true;
        released = true;
        live.set(key, (live.get(key) ?? 0) - 1);
      };
    });
    for (let step = 0; step < 30; step++) {
      const length = Math.floor(random() * 7);
      const ids = Array.from({ length }, () =>
        String.fromCharCode(97 + Math.floor(random() * 5))
      );
      const focus =
        random() < 0.15
          ? undefined
          : String.fromCharCode(97 + Math.floor(random() * 6));
      current = services[Math.floor(random() * services.length)];
      log.push(`${current ? 'svc' : 'off'} [${ids}] @${focus}`);
      window.update(current, ids, focus);
      const index = focus ? ids.indexOf(focus) : -1;
      selection = new Set(
        index < 0
          ? []
          : [index, index + 1, index - 1, index + 2, index - 2]
              .filter((p) => p >= 0 && p < ids.length)
              .map((p) => ids[p])
      );
      vi.advanceTimersByTime(Math.floor(random() * 120));
      for (const [id, count] of live) {
        expect(
          count,
          `seed ${seed}: ${log.join(' | ')}`
        ).toBeGreaterThanOrEqual(0);
        expect(
          count,
          `seed ${seed} duplicate ${id}: ${log.join(' | ')}`
        ).toBeLessThanOrEqual(1);
        if (count && (!current || !selection.has(id)))
          throw new Error(
            `seed ${seed}: ${id} retained outside the window: ${log.join(' | ')}`
          );
      }
    }
    window.dispose();
    disposed = true;
    window.update(services[0], ['a', 'b'], 'a');
    vi.advanceTimersByTime(200);
    for (const [id, count] of live)
      expect(count, `seed ${seed}: ${id} leaked after dispose`).toBe(0);
    expect(releasedTwice, `seed ${seed}`).toBe(false);
    expect(startedAfterDispose, `seed ${seed}`).toBe(false);
    expect(startedWithoutService, `seed ${seed}`).toBe(false);
  }
});

it('maps only email entity rows to thread ids', () => {
  const rows = [
    { kind: 'entity', entity: { type: 'email', id: 'a' } },
    { kind: 'entity', entity: { type: 'document', id: 'doc' } },
    { kind: 'header' },
    { kind: 'entity', entity: { type: 'email', id: 'a' } },
  ] as unknown as Parameters<typeof emailThreadIds>[0];
  expect(emailThreadIds(rows)).toEqual(['a', 'a']);
  expect(emailThreadId(rows[1])).toBeUndefined();
  expect(emailThreadId(undefined)).toBeUndefined();
});
