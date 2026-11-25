import { APP_HANDOFF_PARAMS } from '@app/features/onboarding/core/app-handoff';
import { z } from 'zod';

/**
 * The app claims `macro.com/app/*` as universal and app links, so a page
 * there that the app opens itself can come straight back to the app instead
 * of the browser. `www.macro.com` serves the same web app and is no
 * associated domain, so sign-up stays in the browser. Other origins (the
 * development backend) are opened as they are.
 */
const BROWSER_ORIGINS: Readonly<Record<string, string>> = {
  'https://macro.com': 'https://www.macro.com',
};

/** What the app sends to the browser's sign-up; the verifier stays here. */
export type AppSignupRequest = { challenge: string; handoffId: string };

/** The web sign-up the app opens in the system browser. */
export function appSignupUrl(
  webOrigin: string,
  request: AppSignupRequest
): string {
  const url = new URL('/app/signup', BROWSER_ORIGINS[webOrigin] ?? webOrigin);
  url.searchParams.set(APP_HANDOFF_PARAMS.challenge, request.challenge);
  url.searchParams.set(APP_HANDOFF_PARAMS.handoffId, request.handoffId);
  return url.toString();
}

/** Unpadded base64url, as PKCE writes verifiers and challenges. */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** How long a started sign-up's verifier is kept: a day, as the browser keeps it. */
export const APP_SIGNUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The most sign-ups kept at once; starting another drops the oldest. */
export const APP_SIGNUP_MAX_PENDING = 5;

const PENDING_APP_SIGNUP = z.object({
  handoffId: z.uuid(),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  startedAt: z.number(),
});

/** A sign-up the app started in the browser and waits on. */
export type PendingAppSignup = z.infer<typeof PENDING_APP_SIGNUP>;

const PENDING_APP_SIGNUPS = z.array(PENDING_APP_SIGNUP);

/** The saved sign-ups that are still fresh, newest last. */
export function parsePendingAppSignups(
  raw: string | null,
  now: number
): PendingAppSignup[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = PENDING_APP_SIGNUPS.safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.filter((signup) => {
    const age = now - signup.startedAt;
    return age >= 0 && age <= APP_SIGNUP_MAX_AGE_MS;
  });
}

/** Adds a sign-up, keeping only the newest few. */
export function withPendingAppSignup(
  pending: readonly PendingAppSignup[],
  signup: PendingAppSignup
): PendingAppSignup[] {
  return [...pending, signup].slice(-APP_SIGNUP_MAX_PENDING);
}
