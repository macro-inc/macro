import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { type ErrorResponseHandler, statusError } from '@core/util/safeFetch';
import { match } from 'ts-pattern';
import {
  getClaudeSignOutUrl,
  getCompleteClaudeSignInUrl,
  getGetClaudeModeUrl,
  getStartClaudeSignInUrl,
} from './generated/client';
import type {
  ClaudeModeResponse,
  ClaudeSignedIn,
  ClaudeSignInComplete,
  ClaudeSignInStarted,
} from './generated/schemas';
import { SignInRecoveryCode } from './generated/schemas';

type ClaudeSignInFailureCode =
  | 'CLAUDE_INVALID_CODE'
  | 'CLAUDE_MALFORMED_CODE'
  | 'CLAUDE_SIGN_IN_EXPIRED'
  | 'CLAUDE_COMPUTER_UNREACHABLE'
  | 'CLAUDE_COMPUTER_BUSY'
  | 'CLAUDE_TIMEOUT';

const harnessUrl = (path: (harnessId: string) => string, harnessId: string) =>
  `${SERVER_HOSTS['agent-harness']}${path(encodeURIComponent(harnessId))}`;

/** The recovery code the harness service puts on a sign-in failure, if any. */
async function recoveryCode(
  response: Response
): Promise<SignInRecoveryCode | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('code' in body))
      return undefined;
    const code = body.code;
    // A newer server may send a code this build doesn't know.
    return RECOVERY_CODES.find((known) => known === code);
  } catch {
    // Not JSON: a proxy's error page. The status decides.
    return undefined;
  }
}

const RECOVERY_CODES: readonly SignInRecoveryCode[] =
  Object.values(SignInRecoveryCode);

const claudeSignInError: ErrorResponseHandler<ClaudeSignInFailureCode> = async (
  response
) => {
  // The pending sign-in is gone: it timed out, or another tab replaced it.
  // A 404 is a missing computer, which no new link fixes.
  if (response.status === 410) {
    return {
      code: 'CLAUDE_SIGN_IN_EXPIRED',
      message: 'The Claude sign-in expired',
    };
  }
  if (response.status === 504) {
    return { code: 'CLAUDE_TIMEOUT', message: 'The computer took too long' };
  }
  const code = await recoveryCode(response);
  if (!code) return statusError(response.status);
  const known = match(code)
    .returnType<
      { code: ClaudeSignInFailureCode; message: string } | undefined
    >()
    .with('invalid_code', () => ({
      code: 'CLAUDE_INVALID_CODE',
      message: 'Claude rejected the sign-in code',
    }))
    .with('malformed_code', () => ({
      code: 'CLAUDE_MALFORMED_CODE',
      message: 'The pasted code is not one Claude shows',
    }))
    .with('sign_in_expired', () => ({
      code: 'CLAUDE_SIGN_IN_EXPIRED',
      message: 'The Claude sign-in expired',
    }))
    .with('computer_unreachable', () => ({
      code: 'CLAUDE_COMPUTER_UNREACHABLE',
      message: 'The computer is not reachable',
    }))
    .with('computer_busy', () => ({
      code: 'CLAUDE_COMPUTER_BUSY',
      message: 'The computer is busy',
    }))
    .exhaustive(() => undefined);
  return known ?? statusError(response.status);
};

/** Claude Code sign-in on a Macro computer's runtime. Changes need manage rights. */
export const computerClaudeClient = {
  mode: (harnessId: string) =>
    fetchWithToken<ClaudeModeResponse>(
      harnessUrl(getGetClaudeModeUrl, harnessId)
    ),
  startSignIn: (harnessId: string, signal: AbortSignal) =>
    fetchWithToken<ClaudeSignInStarted, ClaudeSignInFailureCode>(
      harnessUrl(getStartClaudeSignInUrl, harnessId),
      { method: 'POST', signal, errorResponseHandler: claudeSignInError }
    ),
  completeSignIn: (harnessId: string, code: string) =>
    fetchWithToken<ClaudeSignedIn, ClaudeSignInFailureCode>(
      harnessUrl(getCompleteClaudeSignInUrl, harnessId),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code } satisfies ClaudeSignInComplete),
        errorResponseHandler: claudeSignInError,
      }
    ),
  signOut: (harnessId: string) =>
    fetchWithToken<ClaudeModeResponse>(
      harnessUrl(getClaudeSignOutUrl, harnessId),
      { method: 'POST' }
    ),
};
