import { hasLoginCookie } from '@core/util/cookies';
import { thrownResultErrorHasCode } from '@core/util/result';
import { createSignal } from 'solid-js';
import {
  type RefreshOutcome,
  subscribeRefreshOutcome,
} from './refresh-outcome';

/**
 * - `pending`: a login marker exists but user-info has not answered yet.
 * - `signed-in`: user-info confirmed an authenticated user.
 * - `signed-out`: no session (an anonymous visitor, or one already cleared).
 * - `expired`: the device held a session and /jwt/refresh rejected it.
 */
export type SessionStatus = 'pending' | 'signed-in' | 'signed-out' | 'expired';

type SessionIdentity = Exclude<SessionStatus, 'expired'>;

/**
 * Derives the auth state from the user-info query. Data-first: a failed
 * background refetch keeps the previous data alongside the error, and the
 * last-known auth state must survive it — otherwise an offline cold start
 * that restored user-info from cache drops all auth-gated chrome.
 */
export function deriveIsAuthenticated(query: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: { authenticated?: boolean | null } | undefined;
}): boolean | undefined {
  // Only a 401 proves the user is signed out; it wins even over retained data.
  if (thrownResultErrorHasCode(query.error, 'UNAUTHORIZED')) return false;
  if (query.data) return query.data.authenticated ?? false;
  // No data and no definitive signal: a transient failure (network blip, 5xx)
  // leaves the auth state unknown so consumers don't bounce an authenticated
  // user to login.
  if (query.isLoading || query.isError) return undefined;
  return false;
}

/** Maps a derived auth state onto the session identity. */
export function identityFromAuthenticated(
  authenticated: boolean | undefined
): SessionIdentity {
  if (authenticated === undefined) return 'pending';
  return authenticated ? 'signed-in' : 'signed-out';
}

let readIdentity = (): SessionIdentity =>
  hasLoginCookie() ? 'pending' : 'signed-out';

const [identityVersion, bumpIdentity] = createSignal(0, { equals: false });
const [rejected, setRejected] = createSignal(false);

const waiters = new Set<() => void>();

function notifyWaiters() {
  for (const waiter of [...waiters]) waiter();
}

subscribeRefreshOutcome((outcome: RefreshOutcome) => {
  setRejected(outcome === 'rejected');
  notifyWaiters();
});

/**
 * Connects the gate to the source of user identity (the user-info query).
 * `read` must return the current identity synchronously; `subscribe` calls
 * back whenever it may have changed.
 */
export function bindSessionIdentity(
  read: () => SessionIdentity,
  subscribe: (onChange: () => void) => () => void
): () => void {
  readIdentity = read;
  let last = read();
  bumpIdentity(0);
  notifyWaiters();
  // The source fires for events that leave the identity unchanged (observer
  // option updates among them). Re-gating every query on those feeds the
  // events back in, so only a real change reaches the signal.
  return subscribe(() => {
    const next = read();
    if (next === last) return;
    last = next;
    bumpIdentity(0);
    notifyWaiters();
  });
}

/** The current session state. Reactive. */
export function sessionStatus(): SessionStatus {
  identityVersion();
  const identity = readIdentity();
  if (rejected() && (identity === 'signed-in' || hasLoginCookie())) {
    return 'expired';
  }
  return identity;
}

/** Whether authenticated work may run now. Reactive. */
export function hasSession(): boolean {
  return sessionStatus() === 'signed-in';
}

function until<T extends SessionStatus>(
  accept: (status: SessionStatus) => status is T
): Promise<T> {
  const status = sessionStatus();
  if (accept(status)) return Promise.resolve(status);
  return new Promise((resolve) => {
    const check = () => {
      const next = sessionStatus();
      if (!accept(next)) return;
      waiters.delete(check);
      resolve(next);
    };
    waiters.add(check);
  });
}

/** Resolves once the session is known, with the answer. */
export function resolvedSession(): Promise<Exclude<SessionStatus, 'pending'>> {
  return until(
    (status): status is Exclude<SessionStatus, 'pending'> =>
      status !== 'pending'
  );
}

/** Resolves once a user is signed in; waits through sign-out and expiry. */
export function waitForSession(): Promise<'signed-in'> {
  return until((status): status is 'signed-in' => status === 'signed-in');
}

/**
 * Records that the server just confirmed the session (a fresh, authenticated
 * user-info response), which supersedes an earlier refresh rejection.
 */
export function markSessionConfirmed() {
  if (!rejected()) return;
  setRejected(false);
  notifyWaiters();
}
