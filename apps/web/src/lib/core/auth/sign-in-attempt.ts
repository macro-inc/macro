import { encodeBase64UrlBytes } from '@core/util/base64';
import { z } from 'zod';

/**
 * A sign-in whose session code comes back in a URL (the desktop app's
 * `macro:///login` deep link, the development proxy's handoff) answers only
 * the attempt this device started. Anything can open such a URL, so a code
 * that arrives without a pending attempt is someone else's sign-in and is
 * never redeemed: it would put this app into their account.
 *
 * Each attempt also keeps a random verifier and sends the auth service only
 * its S256 challenge (`session_code_challenge` on `/login/sso`). The code the
 * sign-in mints is bound to that challenge and redeems only with the verifier,
 * which never leaves this device until it is spent.
 */

/** The callback URL parameter that names the attempt a session code answers. */
export const SIGN_IN_ATTEMPT_PARAM = 'sign_in_attempt';
/** What a return adds to its URL: the auth service's `token`, and the attempt. */
const EARLIER_RETURN_PARAMS = ['token', SIGN_IN_ATTEMPT_PARAM];

const STORAGE_KEY = 'pendingSignInAttempts';
/** Longer than any sign-in, including fetching a code from an inbox. */
const ATTEMPT_TTL_MS = 15 * 60 * 1000;
/** Abandoned attempts (a closed browser tab) leave at most a few behind. */
const MAX_PENDING_ATTEMPTS = 5;
/** RFC 7636 section 4.1: 32 random bytes make a 43-character verifier. */
const VERIFIER_BYTES = 32;

export type SignInAttempt = {
  id: string;
  /** Sent only to redeem the session code. */
  verifier: string;
  /** `base64url(SHA-256(verifier))`, sent when the sign-in starts. */
  challenge: string;
};

const PENDING_ATTEMPTS_SCHEMA = z.array(
  z.object({ id: z.string(), verifier: z.string(), expiresAt: z.number() })
);

type PendingAttempt = z.infer<typeof PENDING_ATTEMPTS_SCHEMA>[number];

/** The S256 challenge `verifier` answers. */
export async function signInChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return encodeBase64UrlBytes(new Uint8Array(digest));
}

/** A new attempt. Remember it if its code returns through a URL. */
export async function createSignInAttempt(): Promise<SignInAttempt> {
  const verifier = encodeBase64UrlBytes(
    crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES))
  );
  return {
    id: crypto.randomUUID(),
    verifier,
    challenge: await signInChallenge(verifier),
  };
}

function readPending(now: number): PendingAttempt[] {
  try {
    const parsed = PENDING_ATTEMPTS_SCHEMA.safeParse(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    );
    if (!parsed.success) return [];
    return parsed.data.filter((attempt) => attempt.expiresAt > now);
  } catch {
    return [];
  }
}

/** Whether storage took `attempts`. */
function writePending(attempts: PendingAttempt[]): boolean {
  try {
    if (attempts.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps `attempt` until its callback arrives, across the full-page redirect
 * of the web handoff and a desktop app that reloads meanwhile. False when
 * storage refused it: its callback would find no attempt, so don't start
 * the sign-in.
 */
export function rememberSignInAttempt(attempt: SignInAttempt): boolean {
  const now = Date.now();
  const kept = readPending(now).slice(-(MAX_PENDING_ATTEMPTS - 1));
  return writePending([
    ...kept,
    {
      id: attempt.id,
      verifier: attempt.verifier,
      expiresAt: now + ATTEMPT_TTL_MS,
    },
  ]);
}

/**
 * The verifier of the pending attempt `id` names, if there is one. The
 * attempt is forgotten as it is read: it answers one callback, and one that
 * can't be forgotten answers none.
 */
export function takeSignInAttempt(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const pending = readPending(Date.now());
  const attempt = pending.find((candidate) => candidate.id === id);
  if (!attempt) return undefined;
  const forgotten = writePending(
    pending.filter((candidate) => candidate.id !== id)
  );
  return forgotten ? attempt.verifier : undefined;
}

/** Signing out abandons every attempt still pending. */
export function forgetSignInAttempts(): void {
  writePending([]);
}

/**
 * `callbackUrl`, naming `attempt` for the page that redeems its code. The
 * session code and attempt an earlier return left on the page are dropped,
 * under any spelling the page reading the return decodes to their names, so a
 * sign-in started again from a failed return never carries them into its own.
 * The rest of the query is kept byte for byte: the desktop callback's
 * `redirect` is encoded for the auth service's extra decode.
 */
export function withSignInAttempt(
  callbackUrl: string,
  attempt: SignInAttempt
): string {
  const url = new URL(callbackUrl);
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((field) => {
      // Named as the page reading the return decodes it (`%74oken` is a
      // `token`); a leading `&` keeps a name that starts with `?` whole.
      const name = new URLSearchParams(`&${field}`).keys().next().value;
      return name !== undefined && !EARLIER_RETURN_PARAMS.includes(name);
    });
  kept.push(`${SIGN_IN_ATTEMPT_PARAM}=${encodeURIComponent(attempt.id)}`);
  url.search = `?${kept.join('&')}`;
  return url.toString();
}
