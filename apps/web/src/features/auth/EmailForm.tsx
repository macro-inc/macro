import { SERVER_HOSTS } from '@core/constant/servers';
import { platformFetch } from '@core/util/platformFetch';
import { authServiceClient } from '@service-auth/client';
import { action, useSubmission } from '@solidjs/router';
import { Stage } from './Shared';

// Construct the redirect uri to use for passwordless login.
// This will send us back to the application after clicking the magic link.
// in "dev" (local) we use http otherwise https
const protocol = import.meta.hot ? 'http' : 'https';
const REDIRECT_URI = `${protocol}://${window.location.host}/app`;

async function isPasswordLogin(email?: string | null) {
  if (!email) return false;

  const encodedEmail = new TextEncoder().encode(email.toLowerCase());
  const hashedBuffer = await crypto.subtle.digest('SHA-256', encodedEmail);
  const hashedEmail = Array.from(new Uint8Array(hashedBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return (
    hashedEmail ===
    '0d10222b5594dbb0eb5d2bccbc9b5d8e9ff83e99421b573fb32c8a7b74491c81'
  );
}

// Initiates the passwordless login flow.
// Redirecting to the requested identity provider endpoint.
export const sendEmailCode = action(async (formData: FormData) => {
  const email = formData.get('email');
  if (!email || typeof email !== 'string') throw new Error('Invalid email');

  if (typeof email === 'string' && (await isPasswordLogin(email))) {
    const password = formData.get('password');
    if (!password || typeof password !== 'string') return 'isPasswordLogin';

    const maybeTokens = await authServiceClient.passwordLogin({
      password,
      email,
    });
    if (maybeTokens.isErr())
      throw new Error(
        'Failed to login. Check your email and password then try again.'
      );

    return 'LoggedIn';
  }

  const url = new URL(window.location.href);
  const referral_code = url.searchParams.get('referral_code');

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
  );

  if (!response.ok) throw new Error(await response.text());

  // If the passwordless call returns 202,
  // the email needs to login through a dedicated identity provider.
  if (response.status === 202) {
    const body: unknown = await response.json().catch(() => undefined);
    if (
      !body ||
      typeof body !== 'object' ||
      !('idp_id' in body) ||
      typeof body.idp_id !== 'string' ||
      !body.idp_id
    ) {
      throw new Error('Unable to start SSO login for this email.');
    }
    const ssoUrl = new URL(`${SERVER_HOSTS['auth-service']}/login/sso`);
    ssoUrl.searchParams.set('idp_id', body.idp_id);
    ssoUrl.searchParams.set('login_hint', email);
    if (referral_code) ssoUrl.searchParams.set('referral_code', referral_code);
    window.location.href = ssoUrl.toString();
    return false; // passwordless login flow is not reached
  }

  // Local backends return the one-time code so dev tooling (seeded persona
  // tabs) can finish the login without the email round-trip.
  if (import.meta.env.DEV) {
    const body = (await response.json().catch(() => undefined)) as
      | { code?: string }
      | undefined;
    if (body?.code) return { autoCode: body.code };
  }

  return true;
}, 'passwordless-login');

/// True when the email step succeeded and the verify step should show.
export function sentEmailCode(
  result: Awaited<ReturnType<typeof sendEmailCode>> | undefined
): boolean {
  return result === true || (typeof result === 'object' && !!result);
}

/// The local-backend auto-login code, when the email step returned one.
export function autoLoginCode(
  result: Awaited<ReturnType<typeof sendEmailCode>> | undefined
): string | undefined {
  if (typeof result === 'object' && result && 'autoCode' in result) {
    return result.autoCode;
  }
}

export function useResetEmailCode(setStage: (next: Stage) => void) {
  const submission = useSubmission(sendEmailCode);
  return () => {
    submission.clear();
    setStage(Stage.Email);
  };
}
