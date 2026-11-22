import type { ResultError } from '@core/util/result';

/**
 * Whether a failed send leaves its outcome unknown: the request may have
 * reached the harness and been applied, but no answer said so. A network
 * failure, a server error or a gateway timeout is unknown; the harness
 * refusing the action (no runtime access, the usage limit, a 4xx) is a
 * definite answer. A 503 counts as unknown even when the harness sent it
 * while draining, because a gateway in front answers 503 too; that costs
 * the wait, then the message comes back.
 */
export function isUnknownOutcome(errors: ResultError[]): boolean {
  return errors.some(
    (error) =>
      error.code === 'NETWORK_ERROR' ||
      error.code === 'SERVER_ERROR' ||
      error.code === 'INVALID_JSON' ||
      error.code === 'UNKNOWN_ERROR' ||
      (error.code === 'HTTP_ERROR' &&
        error.status !== undefined &&
        (error.status === 408 || error.status >= 500))
  );
}

/**
 * The code of the failure `issue` returns when a send could not be
 * confirmed either way: the composer must not put the message back.
 */
export const SEND_OUTCOME_UNKNOWN = 'SEND_OUTCOME_UNKNOWN' as const;

/** What a check of a send with no clear answer found. */
export type SendCheck =
  | {
      outcome: 'sent';
      /** Where it showed up. */
      via: 'log' | 'queue';
      status: 'sent' | 'queued';
      waitedMs: number;
    }
  /** The queue and a fresh read of the log both answered without it. */
  | { outcome: 'notSent'; waitedMs: number }
  | {
      outcome: 'unknown';
      reason: 'released' | 'queue_unreadable' | 'log_unreadable';
      waitedMs: number;
    };
