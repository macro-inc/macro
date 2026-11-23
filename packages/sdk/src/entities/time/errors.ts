import { match, P } from 'ts-pattern';
import type { RunningTimer } from '../../../generated/storage/types.gen';
import { MacroApiError, unwrap } from '../../utils/unwrap';
import type { Timer } from './timer';

/**
 * Only the person who logged a time entry can change or delete it (HTTP 403);
 * nobody else can, the task's owner included. Tell the user whose entry it
 * is; don't request access, since no access level allows it.
 */
export class NotTimeEntryAuthorError extends MacroApiError {
  constructor(data: unknown) {
    super(403, data);
    this.name = 'NotTimeEntryAuthorError';
  }
}

/**
 * The running timer has run past 8 hours, so nothing was saved (HTTP 409).
 * Ask the user when they stopped working, then call `timer.stop({ endedAt })`,
 * or `timer.stop({ logAll: true })` to log it all (up to 24 hours), or
 * `timer.discard()`.
 * A refused `task.startTimer()` names the timer that was already running;
 * resolve it first, then start again.
 */
export class TimerOverLimitError extends MacroApiError {
  constructor(
    data: unknown,
    /** The timer that ran past the limit. */
    readonly timer: Timer | undefined,
  ) {
    super(409, data);
    this.name = 'TimerOverLimitError';
  }
}

/**
 * @internal Unwrap a time tracking response, raising the refusals a caller
 * acts on as their own errors. `timerOf` builds the handle of a timer past the
 * limit, for the calls that can be refused with one.
 */
export function unwrapTime<TData, TError>(
  res: { data?: TData; error?: TError; response?: Response },
  timerOf?: (record: RunningTimer) => Timer,
): TData {
  if (res.error === undefined) return unwrap(res);
  match({ status: res.response?.status, error: res.error as unknown })
    .with({ status: 403, error: { code: 'not_author' } }, ({ error }) => {
      throw new NotTimeEntryAuthorError(error);
    })
    .with(
      {
        status: 409,
        error: { code: 'timer_over_limit', timer: P.optional(P.select()) },
      },
      (timer, { error }) => {
        throw new TimerOverLimitError(
          error,
          isTimer(timer) ? timerOf?.(timer) : undefined,
        );
      },
    )
    .otherwise(() => undefined);
  return unwrap(res);
}

function isTimer(value: unknown): value is RunningTimer {
  return match(value)
    .with({ id: P.string, taskId: P.string, startedAt: P.string }, () => true)
    .otherwise(() => false);
}
