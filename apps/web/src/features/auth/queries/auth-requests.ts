import {
  restoreSignInAttempt,
  takeSignInAttempt,
} from '@core/auth/sign-in-attempt';
import { SERVER_HOSTS } from '@core/constant/servers';
import { platformFetch } from '@core/util/platformFetch';
import { Telemetry } from '@macro-inc/observability';
import { authServiceClient } from '@service-auth/client';
import type { SendCodeResult, VerifyCodeResult } from '../context/auth-context';

/** Where the passwordless magic link returns. */
const REDIRECT_URI = `${window.location.origin}/app`;

/** The one account that signs in with a password instead of a code. */
const PASSWORD_LOGIN_EMAIL_SHA256 =
  '0d10222b5594dbb0eb5d2bccbc9b5d8e9ff83e99421b573fb32c8a7b74491c81';

async function isPasswordLogin(email: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(email.toLowerCase())
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return hex === PASSWORD_LOGIN_EMAIL_SHA256;
}

const referralCode = () =>
  new URL(window.location.href).searchParams.get('referral_code');

/** Starts passwordless sign-in, or signs in a password account directly. */
export async function sendEmailCode(input: {
  email: string;
  password?: string;
  isAgent: boolean;
}): Promise<SendCodeResult> {
  const { email, password, isAgent } = input;
  if (await isPasswordLogin(email)) {
    if (!password) return { t: 'password-required' };
    const tokens = await authServiceClient.passwordLogin({ password, email });
    return tokens.isErr()
      ? {
          t: 'failed',
          message:
            'Failed to login. Check your email and password then try again.',
        }
      : { t: 'signed-in' };
  }

  const referral_code = referralCode();
  const response = await platformFetch(
    `${SERVER_HOSTS['auth-service']}/login/passwordless`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: REDIRECT_URI,
        email,
        ...(referral_code && { referral_code }),
        ...(isAgent && { is_agent: true }),
      }),
    }
  ).catch(() => undefined);
  if (!response) return { t: 'failed', message: 'Unable to reach Macro.' };
  if (!response.ok) return { t: 'failed', message: await response.text() };

  // 202: the address must sign in through its organization's identity provider.
  if (response.status === 202) {
    const body: unknown = await response.json().catch(() => undefined);
    if (
      !body ||
      typeof body !== 'object' ||
      !('idp_id' in body) ||
      typeof body.idp_id !== 'string' ||
      !body.idp_id
    )
      return {
        t: 'failed',
        message: 'Unable to start SSO login for this email.',
      };
    const sso = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
    sso.searchParams.set('idp_id', body.idp_id);
    sso.searchParams.set('login_hint', email);
    if (referral_code) sso.searchParams.set('referral_code', referral_code);
    window.location.href = sso.toString();
    return { t: 'redirected' };
  }

  // Local backends return the code so seeded persona logins skip the inbox.
  if (import.meta.env.DEV) {
    const body = (await response.json().catch(() => undefined)) as
      | { code?: string }
      | undefined;
    if (body?.code) return { t: 'code-sent', autoCode: body.code };
  }
  return { t: 'code-sent' };
}

export async function verifyEmailCode(input: {
  email: string;
  code: string;
}): Promise<VerifyCodeResult> {
  const result = await authServiceClient.passwordlessCallback(input);
  if (result.isOk()) return { t: 'verified' };
  const code = result.error[0]?.code;
  if (code === 'UNAUTHORIZED') return { t: 'invalid-code' };
  if (code === 'RATE_LIMITED') return { t: 'rate-limited' };
  return { t: 'failed' };
}

/**
 * Exchanges the session code an SSO return carries for session cookies, only
 * when it answers a sign-in this device started: the return must name a
 * pending attempt, whose verifier the code is bound to. Any other code is
 * someone else's sign-in, which would put this app into their account, so it
 * never reaches the auth service. The span records the outcome, never the
 * code or the attempt.
 */
export function exchangeSessionCode(
  token: string,
  attemptId: string | undefined
): Promise<boolean> {
  return Telemetry.span('auth.session_code.exchange', async (span) => {
    const attempt = takeSignInAttempt(attemptId);
    span.setAttr('auth.session_code.attempt_named', attemptId !== undefined);
    if (!attempt) {
      span.setAttr('auth.session_code.outcome', 'no_pending_attempt');
      console.warn('Refused a session code no sign-in here started');
      return false;
    }
    const result = await authServiceClient.sessionLogin({
      session_code: token,
      code_verifier: attempt.verifier,
    });
    if (result.isOk()) {
      span.setAttr('auth.session_code.outcome', 'redeemed');
      return true;
    }
    console.error('Failed to redeem session code', result.error);
    span.setAttr('auth.session_code.outcome', 'redeem_failed');
    // The server keeps a code its own failure didn't redeem, so reopening
    // the callback can try again. Any other answer spent it.
    const codeKept = leavesCodeRedeemable(result.error);
    span.setAttr('auth.session_code.attempt_restored', codeKept);
    if (codeKept) restoreSignInAttempt(attempt);
    return false;
  });
}

/** Whether a failed redemption never reached the server or failed there. */
function leavesCodeRedeemable(
  errors: ReadonlyArray<{ code: string }>
): boolean {
  return (
    errors.length > 0 &&
    errors.every(
      ({ code }) => code === 'NETWORK_ERROR' || code === 'SERVER_ERROR'
    )
  );
}
