import { err, ok, type Result } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  FeedbackFailure,
  FeedbackWrite,
  ResponseFeedbackSource,
} from '../context/response-feedback-context';
import type { FeedbackState } from '../core/subject';

/** A write the fake received, answered by the test. */
export type PendingWrite = {
  id: string;
  write: FeedbackWrite;
  succeed(): void;
  fail(failure?: FeedbackFailure): void;
};

/**
 * One response's rating, held in memory. Each write shows at once, waits for
 * the test to answer it, and goes back to the earlier rating if it fails.
 */
export function createFakeFeedbackSource(initial?: FeedbackState) {
  const [current, setCurrent] = createSignal(initial);
  const writes: PendingWrite[] = [];

  const source: ResponseFeedbackSource = {
    current,
    ready: () => true,
    write(id, write) {
      const previous = current();
      setCurrent(
        write.kind === 'rate'
          ? { rating: write.rating, note: write.note, updatedAt: 'now' }
          : undefined
      );
      return new Promise<Result<void, FeedbackFailure>>((resolve) => {
        writes.push({
          id,
          write,
          succeed: () => resolve(ok(undefined)),
          fail: (failure = 'failed') => {
            setCurrent(previous);
            resolve(err(failure));
          },
        });
      });
    },
  };

  return { source, writes };
}
