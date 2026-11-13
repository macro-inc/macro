import { afterEach, expect, test } from 'bun:test';
import { Subteam } from '../src/entities/teams/subteam';
import { Macro } from '../src/macro';
import { MacroNotFoundError } from '../src/utils';

const SUBTEAM_ID = '0198a4cc-e138-7670-a308-a6b766602710';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a deleted subteam reads as gone, not as its old details', async () => {
  let deleted = false;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      if (
        request.method === 'DELETE' &&
        path === `/team/subteams/${SUBTEAM_ID}`
      ) {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      if (request.method === 'GET' && path === '/team/subteams') {
        return Response.json({ subteams: [] });
      }
      throw new Error(`unexpected request ${request.method} ${path}`);
    },
    { preconnect: originalFetch.preconnect },
  );

  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { auth: 'https://auth.test' },
  });
  const design = Subteam.from(macro._client, {
    id: SUBTEAM_ID,
    parentId: null,
    name: 'Design',
    description: '',
    color: 'pink',
    joinPolicy: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    members: [],
  });
  expect(await design.name()).toBe('Design');

  await design.delete();

  expect(deleted).toBe(true);
  await expect(design.name()).rejects.toBeInstanceOf(MacroNotFoundError);
});
