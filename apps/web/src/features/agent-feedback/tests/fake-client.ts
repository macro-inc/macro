import type { ResultError } from '@core/util/result';
import type { BaseFetchErrorCode } from '@core/util/safeFetch';
import { err, ok, type Result } from 'neverthrow';
import { vi } from 'vitest';
import type { FeedbackState, MyFeedbackItem } from '../core/subject';
import type { AgentFeedbackClient } from '../queries/client';

type Answer<T> = Result<T, ResultError<BaseFetchErrorCode>[]>;

/** A wire failure the way the HTTP client reports it. */
export function httpFailure(code: BaseFetchErrorCode): Answer<never> {
  return err([{ code, message: code }]);
}

/**
 * The harness's feedback routes in memory. `mine` answers with `items`;
 * writes wait until the test calls `release`, so it can look in between.
 */
export function createFakeFeedbackClient(items: MyFeedbackItem[] = []) {
  const held: (() => void)[] = [];
  let nextWrite: Answer<FeedbackState> | undefined;

  const hold = <T>(answer: Answer<T>) =>
    new Promise<Answer<T>>((resolve) => held.push(() => resolve(answer)));

  const client = {
    mine: vi.fn<AgentFeedbackClient['mine']>(async () => ok([...items])),
    rate: vi.fn<AgentFeedbackClient['rate']>((_subject, request) => {
      const answer =
        nextWrite ??
        ok({ rating: request.rating, note: request.note, updatedAt: 'server' });
      nextWrite = undefined;
      return hold(answer);
    }),
    retract: vi.fn<AgentFeedbackClient['retract']>(() => {
      const answer = nextWrite?.isErr() ? err(nextWrite.error) : ok(undefined);
      nextWrite = undefined;
      return hold(answer);
    }),
  } satisfies AgentFeedbackClient;

  return {
    client,
    /** The next write fails this way. */
    failNext(code: BaseFetchErrorCode) {
      nextWrite = httpFailure(code);
    },
    /** Answers every write waiting so far. */
    release() {
      for (const answer of held.splice(0)) answer();
    },
  };
}
