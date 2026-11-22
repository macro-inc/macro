import { match } from 'ts-pattern';
import type {
  ScreenClientEndReason,
  ScreenDriver,
  ScreenEndReason,
} from '../transports/types';

/**
 * What the viewer shows, and what it does next when a connection fails or
 * ends. Pure so the reconnect policy can be tested without sockets.
 */

export type ScreenStatus =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'reconnecting'; attempt: number }
  /** The server is waking the hibernated computer; frames follow. */
  | { kind: 'waking' }
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
  | 'failed';

export type NextStep =
  | { kind: 'show'; status: ScreenStatus }
  | { kind: 'retry'; status: ScreenStatus; delayMs: number };

/** Attempts after a drop before the viewer gives up and offers a manual retry. */
export const MAX_RECONNECT_ATTEMPTS = 6;

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 10_000];

function retryOrFail(attempt: number): NextStep {
  if (attempt > MAX_RECONNECT_ATTEMPTS) {
    return { kind: 'show', status: { kind: 'ended', reason: 'failed' } };
  }
  const delayMs =
    RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length) - 1];
  return { kind: 'retry', status: { kind: 'reconnecting', attempt }, delayMs };
}

/** After a live or connecting session ends. `attempt` counts the retries so far. */
export function afterSessionEnded(
  reason: ScreenEndReason | ScreenClientEndReason,
  attempt: number
): NextStep {
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
        retryOrFail(attempt + 1)
      )
      .exhaustive()
  );
}

/** After minting a ticket (or opening its socket) failed. */
export function afterConnectFailed(
  failure: TicketFailure,
  attempt: number
): NextStep {
  return match(failure)
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
    .with('failed', () => retryOrFail(attempt + 1))
    .exhaustive();
}

/** Whether the picture is current enough to act on. */
export function isLive(status: ScreenStatus): boolean {
  return status.kind === 'live';
}
