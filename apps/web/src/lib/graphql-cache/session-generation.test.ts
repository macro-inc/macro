import { cache } from '@core/util/cache';
import { ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';
import { createSessionGeneration } from './session-generation';

it('keeps helper results across a baseline correction and clears them on a real transition', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(ok({ url: 'before', content: 'old' }))
    .mockResolvedValueOnce(ok({ url: 'after', content: 'fresh' }));
  const cached = cache(fetch, { forever: true });
  const session = createSessionGeneration('hint');
  await cached('document');
  session.initialize('owner');
  expect(await cached('document')).toEqual(
    ok({ url: 'before', content: 'old' })
  );
  expect(fetch).toHaveBeenCalledOnce();
  await session.transition(async () => {}, 'changed');
  expect(await cached('document')).toEqual(
    ok({ url: 'after', content: 'fresh' })
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('establishes the owner baseline without invalidating queries', async () => {
  const session = createSessionGeneration('owner-generation');
  const changed = vi.fn();
  session.onChanged(changed);
  session.initialize('owner-generation');
  const request = session.capture();
  session.initialize('owner-generation');
  expect(session.isCurrent(request)).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(() => session.initialize('replacement')).toThrow(
    'already initialized'
  );
  expect(session.isCurrent(request)).toBe(true);
  await session.transition(async () => {}, 'replacement');
  expect(session.isCurrent(request)).toBe(false);
  expect(changed).toHaveBeenCalledTimes(2);
});

it('corrects a same-access startup hint without retiring in-memory responses', async () => {
  const session = createSessionGeneration('stale-hint');
  const original = session.capture();
  const changed = vi.fn();
  session.onChanged(changed);
  session.initialize('owner-generation');
  expect(changed).not.toHaveBeenCalled();
  expect(session.capture()).toBe('owner-generation');
  expect(session.isCurrent(original)).toBe(true);
  expect(original).toBe('stale-hint');
  expect(session.state().paused).toBe(false);
  session.initialize('owner-generation');
  expect(changed).not.toHaveBeenCalled();
  await session.transition(async () => {}, 'next-generation');
  expect(session.isCurrent(original)).toBe(false);
  expect(session.isCurrent('owner-generation')).toBe(false);
  expect(session.isCurrent('next-generation')).toBe(true);
});

it('closes old response publication immediately while retirement is pending', async () => {
  const session = createSessionGeneration();
  const before = session.capture();
  const retirement = Promise.withResolvers<void>();
  const transition = session.transition(() => retirement.promise);
  expect(session.isCurrent(before)).toBe(false);
  expect(session.isCurrent(session.capture())).toBe(false);
  retirement.resolve();
  await transition;
  expect(session.isCurrent(session.capture())).toBe(true);
  expect(session.isCurrent(before)).toBe(false);
});

it('keeps failed retirement closed until a successful retry', async () => {
  const session = createSessionGeneration();
  await expect(
    session.transition(async () => {
      throw new Error('storage unavailable');
    })
  ).rejects.toThrow('storage unavailable');
  expect(session.isCurrent(session.capture())).toBe(false);
  await session.transition(async () => {});
  expect(session.isCurrent(session.capture())).toBe(true);
});
