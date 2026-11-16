import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { type ErrorResponseHandler, statusError } from '@core/util/safeFetch';
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

type ClaudeSignInErrorCode = 'CLAUDE_INVALID_CODE' | 'CLAUDE_SIGN_IN_EXPIRED';

const harnessUrl = (path: (harnessId: string) => string, harnessId: string) =>
  `${SERVER_HOSTS['agent-harness']}${path(encodeURIComponent(harnessId))}`;

const claudeSignInError: ErrorResponseHandler<ClaudeSignInErrorCode> = async (
  response
) => {
  // The pending sign-in is gone: it timed out, or another tab replaced it.
  if (response.status === 404 || response.status === 410) {
    return {
      code: 'CLAUDE_SIGN_IN_EXPIRED',
      message: 'The Claude sign-in expired',
    };
  }
  if (response.status === 422) {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      body.code === 'invalid_code'
    ) {
      return {
        code: 'CLAUDE_INVALID_CODE',
        message: 'Claude rejected the sign-in code',
      };
    }
  }
  return statusError(response.status);
};

/** Claude Code sign-in on a Macro computer's runtime. Changes need manage rights. */
export const computerClaudeClient = {
  mode: (harnessId: string) =>
    fetchWithToken<ClaudeModeResponse>(
      harnessUrl(getGetClaudeModeUrl, harnessId)
    ),
  startSignIn: (harnessId: string, signal: AbortSignal) =>
    fetchWithToken<ClaudeSignInStarted>(
      harnessUrl(getStartClaudeSignInUrl, harnessId),
      { method: 'POST', signal }
    ),
  completeSignIn: (harnessId: string, code: string, signal: AbortSignal) =>
    fetchWithToken<ClaudeSignedIn, ClaudeSignInErrorCode>(
      harnessUrl(getCompleteClaudeSignInUrl, harnessId),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code } satisfies ClaudeSignInComplete),
        errorResponseHandler: claudeSignInError,
        signal,
      }
    ),
  signOut: (harnessId: string) =>
    fetchWithToken<ClaudeModeResponse>(
      harnessUrl(getClaudeSignOutUrl, harnessId),
      { method: 'POST' }
    ),
};
