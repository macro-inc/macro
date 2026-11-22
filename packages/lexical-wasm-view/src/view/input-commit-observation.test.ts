import { expect, test } from 'vitest';
import { validInputCommitKinds } from './input-commit-native';
import {
  claimInputCommitObservation,
  createInputCommitObservation,
} from './input-commit-observation';

test('pure handle claims once before any reentrant wrapper and reads stable copies', () => {
  const seen: unknown[] = [];
  const observation = createInputCommitObservation((evidence) => {
    seen.push(observation.read(), evidence);
  });
  const unbound = observation.read();
  expect(observation.read()).toBe(unbound);
  const claim = claimInputCommitObservation(observation);
  expect(observation.read().status).toBe('pending');
  expect(() => claimInputCommitObservation(observation)).toThrow(
    'already claimed'
  );
  const notify = claim.finish({ status: 'not-published', entryId: 1n });
  const copied = observation.read();
  expect(Object.isFrozen(copied)).toBe(true);
  expect(observation.read()).toBe(copied);
  notify?.();
  expect(seen).toEqual([copied, copied]);
  expect(() => notify?.()).toThrow('already notified');
  expect(() => claimInputCommitObservation(observation)).toThrow(
    'already claimed'
  );
  expect(() =>
    claim.finish({ status: 'not-published', entryId: 2n })
  ).toThrow();
});

for (const error of [undefined, null, { kind: 'opaque error' }]) {
  test(`pure handle preserves its ${String(error)} holder without freezing the cause`, () => {
    const observation = createInputCommitObservation();
    claimInputCommitObservation(observation).finish({
      status: 'not-entered',
      cause: { status: 'error', error },
    });
    const state = observation.read();
    if (state.status !== 'not-entered' || state.cause.status !== 'error')
      throw new Error('Expected explicit non-entry error holder');
    expect(state.cause.error).toBe(error);
    if (typeof error === 'object' && error !== null)
      expect(Object.isFrozen(error)).toBe(false);
  });
}

test('listener failure cannot replace the already stored copied state', () => {
  const error = { kind: 'listener failure' };
  const observation = createInputCommitObservation(() => {
    throw error;
  });
  const notify = claimInputCommitObservation(observation).finish({
    status: 'published',
    entryId: 2n,
    commitId: 0n,
    mainHandled: false,
  });
  let caught: { error: unknown } | undefined;
  try {
    notify?.();
  } catch (error) {
    caught = { error };
  }
  expect(caught?.error).toBe(error);
  expect(observation.read()).toEqual({
    status: 'published',
    entryId: 2n,
    commitId: 0n,
    mainHandled: false,
  });
});

test('discriminant preflight rejects signed-zero aliases and malformed numeric pairs', () => {
  expect(validInputCommitKinds(0, 1)).toBe(true);
  for (const pair of [
    [0, -0],
    [-0, 0],
    [0, 0],
    [1, 1],
    [Number.NaN, 1],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 1],
    [0, Number.NEGATIVE_INFINITY],
    [0.5, 1],
    [0, '1'],
  ])
    expect(validInputCommitKinds(pair[0], pair[1])).toBe(false);
});
