import { AI_USAGE_LIMIT_ERROR } from '@app/lib/service-clients/ai-usage-limit';
import type { ResultError } from '@core/util/result';
import { NO_RUNTIME_ACCESS_ERROR } from '@service-agent-harness/no-runtime-access';
import { SESSION_ID_TAKEN } from '@service-agent-harness/session-id-taken';

/**
 * Codes the harness answers with when it refused an action before doing any
 * of it.
 */
const REFUSAL_CODES: ReadonlySet<string> = new Set([
  AI_USAGE_LIMIT_ERROR,
  NO_RUNTIME_ACCESS_ERROR,
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'GONE',
  SESSION_ID_TAKEN,
]);

/**
 * Whether the harness definitely refused: one of its refusal codes, or a 4xx
 * other than a request timeout (no runtime, a disconnected session, a
 * sharing change, a bad request). Anything else, including a failure this
 * does not recognise, is not a refusal.
 */
function isRefusal(error: ResultError): boolean {
  if (REFUSAL_CODES.has(error.code)) return true;
  if (error.code !== 'HTTP_ERROR' || error.status === undefined) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408;
}

/**
 * Whether a failed send leaves its outcome unknown: the request may have
 * reached the harness and been applied, but no answer said so. Only a
 * definite refusal is known; a network failure, a server error, a gateway
 * timeout, and any failure not recognised as a refusal are unknown. A 503
 * counts as unknown even when the harness sent it while draining, because a
 * gateway in front answers 503 too; such a message ends on the "Not
 * confirmed" card unless the check finds it.
 */
export function isUnknownOutcome(errors: ResultError[]): boolean {
  return errors.length === 0 || !errors.every(isRefusal);
}

/**
 * The code of the failure `issue` returns when a send could not be
 * confirmed: the message may have run, so it is never put back in the box.
 */
export const SEND_OUTCOME_UNKNOWN = 'SEND_OUTCOME_UNKNOWN' as const;

/** The failure `issue` returns for an unconfirmed send, naming its action. */
export type UnconfirmedSendError = ResultError<typeof SEND_OUTCOME_UNKNOWN> & {
  actionId: string;
};

/** What a check of a send with no clear answer found. */
export type SendCheck =
  | {
      outcome: 'sent';
      /** Where it showed up. */
      via: 'log' | 'queue';
      status: 'sent' | 'queued';
    }
  /**
   * Neither the log nor the queue showed it. The harness may still be
   * running it (admitted, or claimed from the queue and not yet logged), so
   * absence is never taken for "not sent".
   */
  | {
      outcome: 'unknown';
      reason: 'absent' | 'released' | 'queue_unreadable' | 'log_unreadable';
    };
