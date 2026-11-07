import type {
  Problem,
  SequenceErrorCode,
} from '@service-email/generated/schemas';

/** Why a sequences request failed: the server's typed refusal, or no answer. */
export type SequenceFailure =
  | {
      kind: 'refused';
      code: SequenceErrorCode;
      problem?: Problem;
      /** The 1-based email a step problem is about. */
      position?: number;
      tokens?: string[];
    }
  | { kind: 'unavailable' };

/**
 * Whether trying again can help. The server's typed refusals (no team, CRM
 * off, not found, …) are answers, not outages; only an internal error or no
 * answer at all is worth a retry.
 */
export function isRetryable(failure: SequenceFailure) {
  return failure.kind === 'unavailable' || failure.code === 'internal';
}
