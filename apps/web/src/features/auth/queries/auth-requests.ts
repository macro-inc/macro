import { SERVER_HOSTS } from '@core/constant/servers';
import { platformFetch } from '@core/util/platformFetch';
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
}): Promise<SendCodeResult> {
  const { email, password } = input;
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
  return result.error.some((error) => error.code === 'UNAUTHORIZED')
    ? { t: 'invalid-code' }
    : { t: 'failed' };
}

/** Exchanges the session code an SSO return carries for session cookies. */
export async function exchangeSessionCode(token: string): Promise<boolean> {
  const result = await authServiceClient.sessionLogin({ session_code: token });
  if (result.isErr())
    console.error('Failed to redeem session code', result.error);
  return result.isOk();
}
