import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  QueryClientProvider,
  type QueryMeta,
  useQuery,
} from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Outcome = 'rejected' | 'refreshed' | 'reset';

const auth = vi.hoisted(() => ({
  publish: (_outcome: Outcome) => {},
}));

vi.mock('@core/util/cookies', () => ({ hasLoginCookie: () => false }));

type Identity = 'pending' | 'signed-in' | 'signed-out';

type TestQuery = {
  queryKey: string[];
  queryFn: () => Promise<string>;
  meta?: QueryMeta;
  refetchInterval?: number;
};

async function setup(initial: Identity) {
  // Imported after the module reset so `instanceof` matches the gate's copy.
  const { ThrownResultError } = await import('@core/util/result');
  const session = await import('@core/auth/session');
  auth.publish = (
    await import('@core/auth/refresh-outcome')
  ).publishRefreshOutcome;
  const { SessionGatedQueryClient, requiresSession, establishesSession } =
    await import('./session-gate');
  let identity = initial;
  let changed = () => {};
  session.bindSessionIdentity(
    () => identity,
    (onChange) => {
      changed = onChange;
      return () => {};
    }
  );
  const client = new SessionGatedQueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const mount = (options: () => TestQuery) =>
    render(() => {
      function View() {
        useQuery(() => options());
        return null;
      }
      return (
        <QueryClientProvider client={client}>
          <View />
        </QueryClientProvider>
      );
    });
  return {
    client,
    mount,
    unauthorized: () =>
      new ThrownResultError([{ code: 'UNAUTHORIZED', message: '401' }]),
    ThrownResultError,
    requiresSession,
    establishesSession,
    setIdentity: (next: Identity) => {
      identity = next;
      changed();
    },
  };
}

beforeEach(() => vi.resetModules());
afterEach(() => cleanup());

describe('pre-login', () => {
  it('holds a session-only query until sign-in, then fetches it', async () => {
    const gate = await setup('signed-out');
    const queryFn = vi.fn(async () => 'harnesses');
    gate.mount(() => ({
      queryKey: ['harnesses'],
      queryFn,
      meta: gate.requiresSession,
    }));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(queryFn).not.toHaveBeenCalled();

    gate.setIdentity('pending');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(queryFn).not.toHaveBeenCalled();

    gate.setIdentity('signed-in');
    await waitFor(() => expect(queryFn).toHaveBeenCalledOnce());
  });

  it('runs untagged and session-establishing queries for a visitor', async () => {
    const gate = await setup('signed-out');
    const publicDoc = vi.fn(async () => 'doc');
    const userInfo = vi.fn(async () => 'anonymous');
    gate.mount(() => ({ queryKey: ['public-doc'], queryFn: publicDoc }));
    gate.mount(() => ({
      queryKey: ['user-info'],
      queryFn: userInfo,
      meta: gate.establishesSession,
    }));
    await waitFor(() => {
      expect(publicDoc).toHaveBeenCalledOnce();
      expect(userInfo).toHaveBeenCalledOnce();
    });
  });

  it('holds every query in a session-only family, keeping its own meta', async () => {
    const gate = await setup('signed-out');
    gate.client.requireSessionFor([['notification']]);
    const notifications = vi.fn(async () => 'inbox');
    const publicDoc = vi.fn(async () => 'doc');
    gate.mount(() => ({
      queryKey: ['notification', 'user', 'active'],
      queryFn: notifications,
      meta: { groupBy: 'status' },
    }));
    gate.mount(() => ({ queryKey: ['public-doc'], queryFn: publicDoc }));

    await waitFor(() => expect(publicDoc).toHaveBeenCalledOnce());
    expect(notifications).not.toHaveBeenCalled();
    expect(
      gate.client
        .getQueryCache()
        .find({ queryKey: ['notification', 'user', 'active'] })?.meta
    ).toMatchObject({ groupBy: 'status' });

    gate.setIdentity('signed-in');
    await waitFor(() => expect(notifications).toHaveBeenCalledOnce());
  });

  it('lets a family member opt back in with its own session policy', async () => {
    const gate = await setup('signed-out');
    gate.client.requireSessionFor([['auth']]);
    const userInfo = vi.fn(async () => 'anonymous');
    gate.mount(() => ({
      queryKey: ['auth', 'user-info'],
      queryFn: userInfo,
      meta: gate.establishesSession,
    }));
    await waitFor(() => expect(userInfo).toHaveBeenCalledOnce());
  });
});

describe('expired session', () => {
  it('stops every query except the one that re-establishes the session', async () => {
    const gate = await setup('signed-in');
    auth.publish('rejected');
    const soup = vi.fn(async () => 'soup');
    const userInfo = vi.fn(async () => 'me');
    gate.mount(() => ({ queryKey: ['soup'], queryFn: soup }));
    gate.mount(() => ({
      queryKey: ['user-info'],
      queryFn: userInfo,
      meta: gate.establishesSession,
    }));

    await waitFor(() => expect(userInfo).toHaveBeenCalledOnce());
    expect(soup).not.toHaveBeenCalled();

    auth.publish('reset');
    await waitFor(() => expect(soup).toHaveBeenCalledOnce());
  });

  it('stops polling once the session expires', async () => {
    const gate = await setup('signed-in');
    const poll = vi.fn(async () => 'harnesses');
    gate.mount(() => ({
      queryKey: ['poll'],
      queryFn: poll,
      refetchInterval: 20,
    }));
    await waitFor(() => expect(poll.mock.calls.length).toBeGreaterThan(1));

    auth.publish('rejected');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = poll.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(poll).toHaveBeenCalledTimes(calls);
  });
});

describe('401 handling', () => {
  it('never retries a 401, whatever the query asks for', async () => {
    const gate = await setup('signed-in');
    const queryFn = vi.fn(async () => {
      throw gate.unauthorized();
    });
    await expect(
      gate.client.fetchQuery({ queryKey: ['crm'], queryFn, retry: 5 })
    ).rejects.toBeInstanceOf(gate.ThrownResultError);
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it('still retries other failures as configured', async () => {
    const gate = await setup('signed-in');
    const queryFn = vi.fn(async () => {
      throw new Error('503');
    });
    await expect(
      gate.client.fetchQuery({ queryKey: ['flaky'], queryFn, retry: 2 })
    ).rejects.toThrow('503');
    expect(queryFn).toHaveBeenCalledTimes(3);
  });

  it('stops polling while the last fetch was a 401', async () => {
    const gate = await setup('signed-in');
    const poll = vi.fn(async (): Promise<string> => {
      throw gate.unauthorized();
    });
    gate.mount(() => ({
      queryKey: ['poll-401'],
      queryFn: poll,
      refetchInterval: 20,
    }));
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(poll).toHaveBeenCalledOnce();
  });
});
