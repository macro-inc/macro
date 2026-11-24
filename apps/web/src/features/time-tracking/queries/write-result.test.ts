import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';
import { expect, it } from 'vitest';
import { timeWriteError } from './write-result';

function refusal(code: string, extensions: Record<string, unknown> = {}) {
  return new CombinedError({
    graphQLErrors: [
      new GraphQLError(`refused: ${code}`, {
        extensions: { code, ...extensions },
      }),
    ],
  });
}

it('reads the timer a long-running stop was refused for', () => {
  const timer = {
    id: '0196a000-0000-7000-8000-0000000000f1',
    taskId: '0196a000-0000-7000-8000-0000000000a1',
    startedAt: '2026-11-20T03:00:00+00:00',
  };
  expect(timeWriteError(refusal('TIMER_OVER_LIMIT', { timer }))).toEqual({
    kind: 'over-limit',
    timer,
  });
});

it('keeps other refusals with their code and an unreadable timer as a refusal', () => {
  expect(timeWriteError(refusal('NOT_AUTHOR'))).toEqual({
    kind: 'refused',
    code: 'NOT_AUTHOR',
    message: 'refused: NOT_AUTHOR',
  });
  expect(
    timeWriteError(refusal('TIMER_OVER_LIMIT', { timer: { id: 1 } }))
  ).toMatchObject({ kind: 'refused', code: 'TIMER_OVER_LIMIT' });
});

it('reports a request that never reached the server as failed', () => {
  const error = new CombinedError({ networkError: new Error('offline') });
  expect(timeWriteError(error)).toEqual({ kind: 'failed', error });
});
