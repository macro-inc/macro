import { z } from 'zod';

/**
 * Sign-up the native app started in the system browser. The app opens
 * `/signup` with these parameters and keeps the verifier behind the
 * challenge; when the browser's sign-up ends, the page mints a session code
 * bound to the challenge and hands it back through `macro:///login?token=`.
 */
export const APP_HANDOFF_PARAMS = {
  /** `BASE64URL(SHA-256(verifier))`, PKCE `S256`. */
  challenge: 'app_challenge',
  /** Opaque id that ties the app's and the browser's telemetry together. */
  handoffId: 'app_handoff',
} as const;

/** A day: long enough for a slow sign-up, short enough not to linger. */
export const APP_HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Where a session code reaches the app; `/login` redeems `token`. */
const APP_SIGN_IN_URL = 'macro:///login';

const CHALLENGE = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const HANDOFF_ID = z.uuid();

const APP_HANDOFF = z.object({
  challenge: CHALLENGE,
  handoffId: HANDOFF_ID,
  savedAt: z.number(),
});

/** A sign-up the app is waiting on. */
export type AppHandoff = z.infer<typeof APP_HANDOFF>;

/** The handoff an entry link carries, if it carries a valid one. */
export function appHandoffFromParams(
  params: Record<string, unknown>,
  now: number
): AppHandoff | undefined {
  const challenge = CHALLENGE.safeParse(params[APP_HANDOFF_PARAMS.challenge]);
  const handoffId = HANDOFF_ID.safeParse(params[APP_HANDOFF_PARAMS.handoffId]);
  if (!challenge.success || !handoffId.success) return undefined;
  return {
    challenge: challenge.data,
    handoffId: handoffId.data,
    savedAt: now,
  };
}

export const serializeAppHandoff = (handoff: AppHandoff) =>
  JSON.stringify(handoff);

/** A saved handoff that is still fresh; anything else reads as none. */
export function parseAppHandoff(
  raw: string | null,
  now: number
): AppHandoff | undefined {
  if (raw === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = APP_HANDOFF.safeParse(value);
  if (!parsed.success) return undefined;
  const age = now - parsed.data.savedAt;
  return age >= 0 && age <= APP_HANDOFF_MAX_AGE_MS ? parsed.data : undefined;
}

/**
 * The link that hands a session code to the app. The handoff id tells the
 * app which of its verifiers redeems the code, should it have started more
 * than one sign-up.
 */
export function appSignInUrl(sessionCode: string, handoffId: string): string {
  const query = new URLSearchParams({
    token: sessionCode,
    [APP_HANDOFF_PARAMS.handoffId]: handoffId,
  });
  return `${APP_SIGN_IN_URL}?${query}`;
}

/** The app's sign-in link as the last screen shows it. */
export type AppHandoffLink =
  | { t: 'minting' }
  | { t: 'ready'; href: string }
  | { t: 'failed' };
