import { expect, it } from 'vitest';
import { createSessionGeneration } from './session-generation';

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
