import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

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
