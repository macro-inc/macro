import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Outcome = 'rejected' | 'refreshed' | 'reset';

const auth = vi.hoisted(() => ({
  loginCookie: false,
  publish: (_outcome: Outcome) => {},
  fetchToken: vi.fn(),
}));

vi.mock('@core/util/cookies', () => ({
  hasLoginCookie: () => auth.loginCookie,
}));

vi.mock('@core/util/fetchWithToken', () => ({ fetchToken: auth.fetchToken }));

type Identity = 'pending' | 'signed-in' | 'signed-out';

async function loadSession(initial: Identity) {
  const session = {
    ...(await import('./session')),
    ...(await import('./refreshed-session')),
  };
  auth.publish = (await import('./refresh-outcome')).publishRefreshOutcome;
  let identity = initial;
  let changed = () => {};
  session.bindSessionIdentity(
    () => identity,
    (onChange) => {
      changed = onChange;
      return () => {};
    }
  );
  const setIdentity = (next: Identity) => {
    identity = next;
    changed();
  };
  return { ...session, setIdentity };
}

function settled(promise: Promise<unknown>) {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true)
  );
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return done;
  };
}

beforeEach(() => {
  vi.resetModules();
  auth.loginCookie = false;
  auth.fetchToken.mockReset();
});

describe('session status', () => {
  it('is signed-out before any login, and pending while a login is checked', async () => {
    const unbound = await import('./session');
    expect(unbound.sessionStatus()).toBe('signed-out');

    vi.resetModules();
    auth.loginCookie = true;
    const session = await import('./session');
    expect(session.sessionStatus()).toBe('pending');
  });

  it('holds pre-login work until a user signs in', async () => {
    const session = await loadSession('signed-out');
    const waiting = session.waitForSession();
    const isSettled = settled(waiting);
    expect(await isSettled()).toBe(false);

    session.setIdentity('signed-in');
    await expect(waiting).resolves.toBe('signed-in');
  });

  it('resolves a pending session with its answer', async () => {
    auth.loginCookie = true;
    const session = await loadSession('pending');
    const resolved = session.resolvedSession();
    session.setIdentity('signed-out');
    await expect(resolved).resolves.toBe('signed-out');
  });

  it('expires a signed-in session that /jwt/refresh rejected', async () => {
    const session = await loadSession('signed-in');
    expect(session.hasSession()).toBe(true);

    auth.publish('rejected');
    expect(session.sessionStatus()).toBe('expired');
    expect(session.hasSession()).toBe(false);

    const waiting = session.waitForSession();
    const isSettled = settled(waiting);
    expect(await isSettled()).toBe(false);

    // Signing in again resets the refresh state.
    auth.publish('reset');
    await expect(waiting).resolves.toBe('signed-in');
  });

  it('clears an expiry once the server confirms the session again', async () => {
    const session = await loadSession('signed-in');
    auth.publish('rejected');
    session.markSessionConfirmed();
    expect(session.sessionStatus()).toBe('signed-in');
  });

  it('does not expire an anonymous visitor whose refresh was rejected', async () => {
    const session = await loadSession('signed-out');
    auth.publish('rejected');
    expect(session.sessionStatus()).toBe('signed-out');
  });
});

describe('refreshedSession', () => {
  it('refreshes the cookie for a signed-in session', async () => {
    auth.fetchToken.mockResolvedValue(ok(undefined));
    const session = await loadSession('signed-in');
    await expect(session.refreshedSession()).resolves.toBeUndefined();
    expect(auth.fetchToken).toHaveBeenCalledOnce();
  });

  it('never refreshes before sign-in', async () => {
    auth.fetchToken.mockResolvedValue(ok(undefined));
    const session = await loadSession('signed-out');
    const refreshed = session.refreshedSession();
    const isSettled = settled(refreshed);
    expect(await isSettled()).toBe(false);
    expect(auth.fetchToken).not.toHaveBeenCalled();

    session.setIdentity('signed-in');
    await refreshed;
    expect(auth.fetchToken).toHaveBeenCalledOnce();
  });

  it('refreshes once on a rejected session, then waits for sign-in instead of looping', async () => {
    const session = await loadSession('signed-in');
    auth.fetchToken.mockImplementationOnce(async () => {
      auth.publish('rejected');
      return err([{ code: 'UNAUTHORIZED', message: 'invalid refresh token' }]);
    });
    auth.fetchToken.mockResolvedValue(ok(undefined));

    const refreshed = session.refreshedSession();
    const isSettled = settled(refreshed);
    expect(await isSettled()).toBe(false);
    expect(auth.fetchToken).toHaveBeenCalledOnce();

    auth.publish('reset');
    await refreshed;
    expect(auth.fetchToken).toHaveBeenCalledTimes(2);
  });

  it('hands a transient refresh failure to the caller', async () => {
    auth.fetchToken.mockResolvedValue(
      err([{ code: 'NETWORK_ERROR', message: 'offline' }])
    );
    const session = await loadSession('signed-in');
    await expect(session.refreshedSession()).rejects.toBeInstanceOf(
      session.SessionRefreshUnavailableError
    );
  });

  it('does not spin when a rejection leaves the session signed in', async () => {
    auth.fetchToken.mockResolvedValue(
      err([{ code: 'UNAUTHORIZED', message: 'raced a sign-in' }])
    );
    const session = await loadSession('signed-in');
    await expect(session.refreshedSession()).rejects.toBeInstanceOf(
      session.SessionRefreshUnavailableError
    );
    expect(auth.fetchToken).toHaveBeenCalledOnce();
  });
});
