import { thrownResultErrorHasCode } from '@core/util/result';
import { match } from 'ts-pattern';

/** Why a Claude sign-in stopped, as the dialog explains it. */
export type ClaudeSignInFailure =
  /** The sign-in on the computer is gone: too old, replaced, or cancelled. */
  | 'expired'
  /** Claude refused the code; that sign-in is used up. */
  | 'invalid_code'
  /** Not something Claude shows: a typo or a partial paste. */
  | 'malformed_code'
  /** The computer or its sign-in service can't be reached. */
  | 'unreachable'
  /** The computer is answering another request. */
  | 'busy'
  /** The computer took too long. */
  | 'timeout'
  | 'failed';

/** Which way out a failure offers. */
export type ClaudeSignInRecovery =
  /** Start a new sign-in: a new link, then a new code. */
  | 'new_link'
  /** Send the same request again. */
  | 'retry'
  /** Paste the code again; the sign-in is still waiting. */
  | 'repaste';

export function claudeSignInFailure(error: unknown): ClaudeSignInFailure {
  if (thrownResultErrorHasCode(error, 'CLAUDE_SIGN_IN_EXPIRED'))
    return 'expired';
  if (thrownResultErrorHasCode(error, 'CLAUDE_INVALID_CODE'))
    return 'invalid_code';
  if (thrownResultErrorHasCode(error, 'CLAUDE_MALFORMED_CODE'))
    return 'malformed_code';
  if (thrownResultErrorHasCode(error, 'CLAUDE_COMPUTER_UNREACHABLE'))
    return 'unreachable';
  if (thrownResultErrorHasCode(error, 'CLAUDE_COMPUTER_BUSY')) return 'busy';
  if (thrownResultErrorHasCode(error, 'CLAUDE_TIMEOUT')) return 'timeout';
  return 'failed';
}

/**
 * How to recover. Starting a sign-in is safe to repeat, so any failure to
 * start retries; once a code was sent, only a failure that leaves the
 * computer's sign-in waiting lets the user paste again.
 */
export function claudeSignInRecovery(
  phase: 'start' | 'complete',
  failure: ClaudeSignInFailure
): ClaudeSignInRecovery {
  if (phase === 'start') return 'retry';
  return (
    match(failure)
      .returnType<ClaudeSignInRecovery>()
      // A timeout here is the service giving up on the computer, which may
      // still be storing the credential: sending the code again either signs
      // in or finds the sign-in over. harnessd's own timeout ends the
      // sign-in and arrives as expired instead.
      .with('malformed_code', 'busy', 'unreachable', 'timeout', () => 'repaste')
      .with('expired', 'invalid_code', 'failed', () => 'new_link')
      .exhaustive()
  );
}
