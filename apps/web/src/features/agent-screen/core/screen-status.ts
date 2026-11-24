import { match } from 'ts-pattern';
import type {
  ScreenClientEndReason,
  ScreenDriver,
  ScreenEndReason,
  ScreenErrorCode,
} from '../transports/types';

/**
 * What the viewer shows, and what it does next when a connection fails or
 * ends. Pure so the reconnect policy can be tested without sockets.
 */

export type ScreenStatus =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | {
      kind: 'reconnecting';
      attempt: number;
      /** Waiting out the ticket rate limit (`TICKET_RATE_WINDOW_MS`). */
      rateLimited?: true;
    }
  /**
   * The computer is starting: the server woke it from hibernation, or this
   * person turned it on (`turningOn`). Frames follow.
   */
  | { kind: 'waking'; turningOn?: true }
  /** The computer is asleep, off or unreachable; Turn on may help. */
  | { kind: 'asleep' }
  | { kind: 'denied'; reason: 'cannotWatch' | 'rolloutDisabled' }
  | {
      kind: 'ended';
      reason:
        | 'stopped'
        /** Closed while this tab was hidden; it comes back when shown. */
        | 'idle'
        | 'accessRevoked'
        | 'notFound'
        /** The computer has as many screens open as it allows; not retried. */
        | 'tooManyScreens'
        /** Still rate limited after waiting out the window once. */
        | 'rateLimited'
        /** A computer turned on (or woken) whose screen never came up. */
        | 'didNotStart'
        | 'failed';
    };

/** What to tell a viewer whose connection dropped while it was driving. */
export type ControlLost =
  | { kind: 'reconnecting' }
  /**
   * No longer driving: the lease lapsed, or `driver` took it; `reconnected`
   * when that was found after a reconnect.
   */
  | {
      kind: 'released';
      driver: ScreenDriver | null;
      reconnected: boolean;
      /** The server's reason, when it gave one. */
      reason?: 'agentNotPausable';
    };

/** Why minting a ticket failed, from the service client's error codes. */
export type TicketFailure =
  | 'forbidden'
  | 'rolloutDisabled'
  | 'notFound'
  /** This person minted too many tickets lately (the ticket rate limit). */
  | 'rateLimited'
  /** The computer's screens are all in use, said at ticket time. */
  | 'tooManyScreens'
  | 'failed';

export type NextStep =
  | { kind: 'show'; status: ScreenStatus }
  | {
      kind: 'retry';
      status: ScreenStatus;
      delayMs: number;
      /** One of the quick retries after a steady connection dropped. */
      quick?: true;
    };

/** Attempts after a drop before the viewer gives up and offers a manual retry. */
export const MAX_RECONNECT_ATTEMPTS = 6;

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 10_000];

/**
 * The longest wait between retries for a connection that was live a moment
 * ago (`RetryContext.recentlyLive`): a blip should come back in seconds.
 */
export const RECENTLY_LIVE_MAX_DELAY_MS = 2000;

/**
 * Quick retries one drop may use. Each mints a ticket, and the harness allows
 * a person 30 a minute across their tabs: ten leave room for the rest.
 */
export const QUICK_RETRIES = 10;

/** The harness's ticket rate-limit window, waited out once before retrying. */
export const TICKET_RATE_WINDOW_MS = 60_000;

/** What the session knows about the connection that just failed. */
export type RetryContext = {
  /** A steady connection was live until a moment ago: retry quickly. */
  recentlyLive: boolean;
  /** Quick retries this drop has used (`QUICK_RETRIES` at most). */
  quickUsed: number;
  /** The server's last error on the failed socket. */
  lastError?: ScreenErrorCode;
  /** The attempt that just failed was the retry after a rate limit. */
  afterRateLimit?: boolean;
};

const NO_CONTEXT: RetryContext = { recentlyLive: false, quickUsed: 0 };

/**
 * `attempt` counts every retry of this drop. The first `QUICK_RETRIES` after a
 * steady connection dropped come at most 2 s apart; then, or for any other
 * failure, the usual backoff runs, continuing past the delays the quick
 * retries already covered, and gives up after `MAX_RECONNECT_ATTEMPTS` of its
 * own.
 */
function retryOrFail(attempt: number, context: RetryContext): NextStep {
  if (context.recentlyLive && context.quickUsed < QUICK_RETRIES) {
    const backoff =
      RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length) - 1];
    return {
      kind: 'retry',
      status: { kind: 'reconnecting', attempt },
      delayMs: Math.min(backoff, RECENTLY_LIVE_MAX_DELAY_MS),
      quick: true,
    };
  }
  // After quick retries the backoff resumes where they left off (at 4 s).
  const covered = context.quickUsed > 0 ? 3 : 0;
  const slow = attempt - context.quickUsed;
  if (slow + covered > MAX_RECONNECT_ATTEMPTS) {
    return { kind: 'show', status: { kind: 'ended', reason: 'failed' } };
  }
  const delayMs =
    RECONNECT_DELAYS_MS[
      Math.min(slow + covered, RECONNECT_DELAYS_MS.length) - 1
    ];
  return { kind: 'retry', status: { kind: 'reconnecting', attempt }, delayMs };
}

/** After a live or connecting session ends. `attempt` counts the retries so far. */
export function afterSessionEnded(
  reason: ScreenEndReason | ScreenClientEndReason,
  attempt: number,
  context: RetryContext = NO_CONTEXT
): NextStep {
  // Refused for being one screen too many: another try now fails the same.
  if (context.lastError === 'tooManySockets' && reason !== 'stopped') {
    return {
      kind: 'show',
      status: { kind: 'ended', reason: 'tooManyScreens' },
    };
  }
  return (
    match(reason)
      .returnType<NextStep>()
      .with('stopped', () => ({
        kind: 'show',
        status: { kind: 'ended', reason: 'stopped' },
      }))
      // Nobody was looking: not a drop to retry, but the session reconnects
      // when the tab is shown again.
      .with('idle', () => ({
        kind: 'show',
        status: { kind: 'ended', reason: 'idle' },
      }))
      .with('accessRevoked', () => ({
        kind: 'show',
        status: { kind: 'ended', reason: 'accessRevoked' },
      }))
      .with('computerOff', () => ({ kind: 'show', status: { kind: 'asleep' } }))
      // A restarting harness or a dropped socket: a new ticket usually works.
      .with('shutdown', 'connectionLost', 'error', () =>
        retryOrFail(attempt + 1, context)
      )
      .exhaustive()
  );
}

/** After minting a ticket (or opening its socket) failed. */
export function afterConnectFailed(
  failure: TicketFailure,
  attempt: number,
  context: RetryContext = NO_CONTEXT
): NextStep {
  return (
    match(failure)
      .returnType<NextStep>()
      .with('forbidden', () => ({
        kind: 'show',
        status: { kind: 'denied', reason: 'cannotWatch' },
      }))
      .with('rolloutDisabled', () => ({
        kind: 'show',
        status: { kind: 'denied', reason: 'rolloutDisabled' },
      }))
      .with('notFound', () => ({
        kind: 'show',
        status: { kind: 'ended', reason: 'notFound' },
      }))
      .with('tooManyScreens', () => ({
        kind: 'show',
        status: { kind: 'ended', reason: 'tooManyScreens' },
      }))
      // Wait out the window once; still limited after it, the person decides.
      .with('rateLimited', () =>
        context.afterRateLimit
          ? {
              kind: 'show',
              status: { kind: 'ended', reason: 'rateLimited' },
            }
          : {
              kind: 'retry',
              status: { kind: 'reconnecting', attempt, rateLimited: true },
              delayMs: TICKET_RATE_WINDOW_MS,
            }
      )
      .with('failed', () => retryOrFail(attempt + 1, context))
      .exhaustive()
  );
}

/** How long a computer gets to boot before failures count as failures. */
export const BOOT_TIMEOUT_MS = 120_000;

/**
 * Between tries while the computer boots, by try: quick while it usually
 * comes up, then every 5 s. Each try mints a ticket: about 12 a minute and
 * 25 a boot, well under the harness's 30 a minute per person.
 */
export const BOOT_RETRY_DELAYS_MS = [2000, 4000, 5000];

/** The server's errors that mean the screen isn't up yet, during a boot. */
const NOT_UP_YET: ReadonlySet<ScreenErrorCode> = new Set([
  'tunnelFailed',
  'sourceUnavailable',
]);

/**
 * While the computer boots, a screen that isn't reachable yet (the tunnel or
 * the guest not up, "off" until it is on, a socket that drops) is the boot,
 * not a failure: the viewer keeps saying it is waking and tries again.
 * `bootTry` counts those tries. Anything else stands: final ends, the rate
 * limit, and a socket that ended on another error (`lastError`).
 */
export function whileBooting(
  step: NextStep,
  waking: Extract<ScreenStatus, { kind: 'waking' }>,
  boot: { bootTry: number; lastError?: ScreenErrorCode }
): NextStep {
  const asleep = step.kind === 'show' && step.status.kind === 'asleep';
  if (step.kind !== 'retry' && !asleep) return step;
  if (
    step.kind === 'retry' &&
    step.status.kind === 'reconnecting' &&
    step.status.rateLimited
  )
    return step;
  if (boot.lastError !== undefined && !NOT_UP_YET.has(boot.lastError))
    return step;
  const delayMs =
    BOOT_RETRY_DELAYS_MS[
      Math.min(boot.bootTry, BOOT_RETRY_DELAYS_MS.length - 1)
    ];
  return { kind: 'retry', status: waking, delayMs };
}

/**
 * The boot window passed with no picture: a failure that would have been
 * ridden out ends as `didNotStart`, the boot's own end, instead of a
 * reconnect backoff. Anything else stands.
 */
export function afterBootWindow(
  step: NextStep,
  lastError?: ScreenErrorCode
): NextStep {
  const ridden = whileBooting(
    step,
    { kind: 'waking' },
    { bootTry: 0, lastError }
  );
  if (ridden === step) return step;
  return { kind: 'show', status: { kind: 'ended', reason: 'didNotStart' } };
}

/** Whether the picture is current enough to act on. */
export function isLive(status: ScreenStatus): boolean {
  return status.kind === 'live';
}
