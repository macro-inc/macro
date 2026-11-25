import type { Woke } from '@macro-inc/muppet/core/agent';
import { budgetRefused } from '../../agent/budget.ts';
import type { TraceSpan } from '../../agent/claude.ts';

/**
 * How a wake ended, as a span records it: `done`, or `failed` with a
 * category. Never the error's text, which can quote what the agent read.
 */
export const wakeOutcome = (
  woke: Woke
): {
  readonly outcome: 'done' | 'failed';
  readonly category?: 'budget' | 'timed_out' | 'error';
} =>
  woke.kind === 'done'
    ? { outcome: 'done' }
    : {
        outcome: 'failed',
        category: budgetRefused(woke.error)
          ? 'budget'
          : woke.error.startsWith('timed out')
            ? 'timed_out'
            : 'error',
      };

/** Records a wake's end on `span` under `prefix` (`<prefix>.outcome`, `<prefix>.error_category`). */
export const recordOutcome = (
  span: TraceSpan,
  prefix: string,
  woke: Woke
): void => {
  const { outcome, category } = wakeOutcome(woke);
  span.set(`${prefix}.outcome`, outcome);
  if (category !== undefined) {
    span.set(`${prefix}.error_category`, category);
    // Error status, so error filters find it; the category is all it says.
    span.fail?.(category);
  }
};

/** Milliseconds from an ISO instant to `now`, or undefined when `at` isn't one. */
export const millisecondsSince = (
  at: string | undefined,
  now: Temporal.Instant
): number | undefined => {
  if (at === undefined) return undefined;
  try {
    return Math.max(
      0,
      Math.round(now.since(Temporal.Instant.from(at)).total('milliseconds'))
    );
  } catch {
    return undefined;
  }
};
