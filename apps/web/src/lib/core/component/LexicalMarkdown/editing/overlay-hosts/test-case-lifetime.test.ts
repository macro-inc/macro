import { expect, test } from 'vitest';
import { joinThenRelease } from './test-case-lifetime';

test('order control: no release starts before every join settles', async () => {
  const events: string[] = [];
  const work = Promise.withResolvers<void>();
  const releasing = joinThenRelease(
    [
      async () => {
        events.push('join entered');
        await work.promise;
        events.push('join settled');
      },
    ],
    [() => events.push('root released'), () => events.push('runtime closed')],
    1000
  );
  // The join is still pending, so nothing may have been released yet.
  await Promise.resolve();
  expect(events).toEqual(['join entered']);
  work.resolve();
  await expect(releasing).resolves.toEqual({ status: 'released', errors: [] });
  expect(events).toEqual([
    'join entered',
    'join settled',
    'runtime closed',
    'root released',
  ]);
});

test('fault control: a join that never settles retains every resource', async () => {
  const released: string[] = [];
  const outcome = await joinThenRelease(
    [() => new Promise<never>(() => {})],
    [() => released.push('root'), () => released.push('runtime')],
    20
  );
  expect(outcome).toEqual({ status: 'retained', errors: [] });
  expect(released).toEqual([]);
});

test('fault control: a rejected join is reported and still releases after it', async () => {
  const events: string[] = [];
  const failure = new Error('select rejected');
  const outcome = await joinThenRelease(
    [
      async () => {
        events.push('join');
        throw failure;
      },
    ],
    [() => events.push('runtime closed')],
    1000
  );
  expect(outcome).toEqual({ status: 'released', errors: [failure] });
  expect(events).toEqual(['join', 'runtime closed']);
});
