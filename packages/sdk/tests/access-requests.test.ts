import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Agent } from '../src/entities/agents/agent';
import { User } from '../src/entities/users/user';
import { Macro } from '../src/macro';
import { MacroApiError, MacroForbiddenError } from '../src/utils';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const initiativeId = '0198a4cc-e138-7670-a308-a6b766602730';
const requestId = '0198a4cc-e138-7670-a308-a6b766602731';

function record(status: string, revision: number) {
  return {
    id: requestId,
    requesterId: 'macro|reader@example.test',
    requestedLevel: status === 'pending' ? 'edit' : 'comment',
    status,
    revision,
    createdAt: '2026-10-30T12:00:00Z',
    updatedAt: '2026-10-30T12:00:00Z',
    resolvedAt: null,
    grantedLevel: status === 'granted' ? 'comment' : null,
    retryAfter: null,
  };
}

function state(mine: ReturnType<typeof record> | null) {
  return {
    owner: 'macro|owner@example.test',
    canReview: false,
    accessLevel: 'comment',
    supportedLevels: ['view', 'comment', 'edit'],
    mine,
    requests: [],
    pendingCount: 0,
    nextOffset: null,
  };
}

describe('EntityAccess.request', () => {
  test('supersedes the latest request at its revision', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json(
        request.method === 'GET'
          ? state(record('granted', 2))
          : record('pending', 3),
      );
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const request = await macro.initiatives
      .byId(initiativeId)
      .access.request('edit');

    expect(await request.status()).toBe('pending');
    expect(requests.map((r) => r.method)).toEqual(['GET', 'PUT']);
    expect(new URL(requests[1].url).pathname).toBe(
      `/entities/initiative/${initiativeId}/access-requests/mine`,
    );
    expect(await requests[1].json()).toEqual({
      requestedLevel: 'edit',
      revision: 2,
    });
  });

  test('sends a first request without a revision', async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.method === 'GET') return Response.json(state(null));
      bodies.push(await request.json());
      return Response.json(record('pending', 1));
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    await macro.documents.byId(initiativeId).access.request('edit');

    expect(bodies).toEqual([{ requestedLevel: 'edit' }]);
  });
});

describe('MacroForbiddenError', () => {
  test('a refused write throws the forbidden error', async () => {
    globalThis.fetch = (async (_input) =>
      Response.json(
        { message: 'Access denied' },
        { status: 403 },
      )) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const error = await macro.documents
      .byId(initiativeId)
      .rename('Renamed')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MacroForbiddenError);
    expect(error).toBeInstanceOf(MacroApiError);
    expect((error as MacroForbiddenError).status).toBe(403);
    expect((error as Error).message).toBe('Macro API error 403: Access denied');
  });

  test('other failures stay plain API errors', async () => {
    globalThis.fetch = (async (_input) =>
      Response.json({ message: 'Not found' }, { status: 404 })) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const error = await macro.documents
      .byId(initiativeId)
      .rename('Renamed')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MacroApiError);
    expect(error).not.toBeInstanceOf(MacroForbiddenError);
  });
});

describe('Harness access', () => {
  const harnessId = '0198a4cc-e138-7670-a308-a6b766602732';

  test('returns distinct lazy handles for bot and account residents', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([
        {
          type: 'bot',
          bot_id: '0198a4cc-e138-7670-a308-a6b766602733',
          name: 'Assistant',
          owner_user_id: 'macro|owner@example.test',
          team_id: null,
        },
        {
          type: 'account',
          user_id: 'macro|agent@example.test',
          name: 'Teammate',
          team_id: '0198a4cc-e138-7670-a308-a6b766602734',
        },
        { type: 'future_resident', name: 'Unknown resident' },
      ]),
    );
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    const residents = await macro.harnesses.byId(harnessId).residents();

    expect(residents).toHaveLength(2);
    expect(residents[0]).toBeInstanceOf(Agent);
    expect(residents[0]?.id).toBe('0198a4cc-e138-7670-a308-a6b766602733');
    expect(residents[1]).toBeInstanceOf(User);
    expect(residents[1]?.id).toBe('macro|agent@example.test');
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a request');
    expect(new URL(request.url).pathname).toBe(
      `/harnesses/${harnessId}/residents`,
    );
  });

  test('asks to be a user unless told otherwise', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return Response.json(
        request.method === 'GET'
          ? {
              ...state(null),
              accessLevel: null,
              supportedLevels: ['view', 'edit'],
            }
          : record('pending', 1),
      );
    }) as typeof fetch;
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });

    await macro.harnesses.byId(harnessId).requestAccess();

    const submitted = requests.at(-1);
    expect(new URL(submitted?.url ?? '').pathname).toBe(
      `/entities/harness/${harnessId}/access-requests/mine`,
    );
    expect(await submitted?.json()).toMatchObject({ requestedLevel: 'edit' });
  });
});
