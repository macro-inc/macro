import { openSystemBrowser } from '@core/auth/native-auth';
import { holdAutomaticReload } from '@core/util/reloadForNewerBuild';
import { getWebOrigin } from '@core/util/webOrigin';
import { Telemetry } from '@macro-inc/observability';
import {
  appSignupUrl,
  base64Url,
  type PendingAppSignup,
  parsePendingAppSignups,
  withPendingAppSignup,
} from '../core/app-signup';

/**
 * Sign-ups the app sent to the browser, each with the verifier its session
 * code redeems with. localStorage, so they outlive the app being closed
 * while the person signs up.
 */
const STORAGE_KEY = 'macro:app-signups';

/** Released after this long without a redemption: the person went elsewhere. */
const RELOAD_HOLD_MS = 30 * 60 * 1000;

function readPending(now: number): PendingAppSignup[] {
  try {
    return parsePendingAppSignups(localStorage.getItem(STORAGE_KEY), now);
  } catch {
    return [];
  }
}

function writePending(pending: readonly PendingAppSignup[]) {
  try {
    if (pending.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Unavailable storage loses the sign-up; the person can still log in.
  }
}

/**
 * The browser's return reaches only the page that is open when it arrives,
 * and coming back to the app is when a downloaded update reloads it. Hold
 * reloads from the moment the browser opens until a sign-in arrives or the
 * person has clearly gone elsewhere. One hold covers every sign-up started.
 */
let releaseReloadHold: (() => void) | undefined;
let reloadHoldTimer: ReturnType<typeof setTimeout> | undefined;

function holdReloadsForSignup() {
  releaseReloadHold ??= holdAutomaticReload();
  clearTimeout(reloadHoldTimer);
  reloadHoldTimer = setTimeout(releaseReloadsForSignup, RELOAD_HOLD_MS);
}

function releaseReloadsForSignup() {
  clearTimeout(reloadHoldTimer);
  releaseReloadHold?.();
  releaseReloadHold = undefined;
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

/**
 * Sends the person to sign up in the system browser. The browser gets only
 * the challenge; the verifier stays in the app, so the session code the
 * browser hands back (`macro:///login?token=&app_handoff=`) signs in only
 * here.
 */
export function startAppSignup(): Promise<'opened' | 'failed'> {
  return Telemetry.span('auth.app_signup.start', async (span) => {
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const handoffId = crypto.randomUUID();
    span.setAttr('auth.app_handoff.id', handoffId);
    const now = Date.now();
    writePending(
      withPendingAppSignup(readPending(now), {
        handoffId,
        verifier,
        startedAt: now,
      })
    );
    // A sign-up started earlier may still come back; keep its hold.
    const waitingAlready = releaseReloadHold !== undefined;
    holdReloadsForSignup();

    const url = appSignupUrl(getWebOrigin(), {
      challenge: await challengeOf(verifier),
      handoffId,
    });
    const opened = await openSystemBrowser(url);
    span.setAttr('auth.app_handoff.outcome', opened ? 'opened' : 'open_failed');
    if (!opened && !waitingAlready) releaseReloadsForSignup();
    return opened ? 'opened' : 'failed';
  });
}

/** The verifier of a sign-up this app started, if it is still waiting. */
export function appSignupVerifier(handoffId: string): string | undefined {
  return readPending(Date.now()).find(
    (signup) => signup.handoffId === handoffId
  )?.verifier;
}

/** The sign-up signed in: forget every pending one and allow reloads again. */
export function finishAppSignups() {
  writePending([]);
  releaseReloadsForSignup();
}
