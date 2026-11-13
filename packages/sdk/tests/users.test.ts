import { afterEach, expect, test } from 'bun:test';
import { type AgentSpend, Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('person search makes one ranked server search and keeps its order', async () => {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json({
        people: [
          {
            userId: 'macro|alice@example.com',
            name: 'Alice One',
            isTeammate: true,
            isAgent: false,
          },
          {
            userId: 'macro|alice-bot@example.com',
            name: null,
            isTeammate: true,
            isAgent: true,
          },
          {
            userId: 'macro|alice.other@example.com',
            name: 'Alice Two',
            isTeammate: false,
            isAgent: false,
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { contacts: 'https://contacts.test', auth: 'https://auth.test' },
  });

  const matches = await macro.users.search('  ALICE ');

  expect(matches.map((user) => ({ id: user.id, email: user.email() }))).toEqual(
    [
      { id: 'macro|alice@example.com', email: 'alice@example.com' },
      { id: 'macro|alice-bot@example.com', email: 'alice-bot@example.com' },
      { id: 'macro|alice.other@example.com', email: 'alice.other@example.com' },
    ],
  );
  expect(await Promise.all(matches.map((user) => user.name()))).toEqual([
    'Alice One',
    undefined,
    'Alice Two',
  ]);
  expect(await Promise.all(matches.map((user) => user.isAgent()))).toEqual([
    false,
    true,
    false,
  ]);
  expect(requests.map((request) => request.url)).toEqual([
    'https://contacts.test/contacts/search?query=ALICE',
  ]);
  expect(requests[0].headers.get('x-macro-user-api-key')).toBe('mak_test');
});

test('person search failures propagate and a blank query is refused', async () => {
  let status = 401;
  globalThis.fetch = Object.assign(
    async () => Response.json(null, { status }),
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { contacts: 'https://contacts.test' },
  });

  await expect(macro.users.search('Alice')).rejects.toThrow();
  status = 500;
  await expect(macro.users.search('Alice')).rejects.toThrow();
  await expect(macro.users.search('  ')).rejects.toThrow('name or email');
});

test('agent spend reads one bucketed window for the agent account', async () => {
  const requests: Request[] = [];
  const body: AgentSpend = {
    bucket: 'week',
    from: '2026-05-18T00:00:00Z',
    until: '2026-11-13T07:00:00Z',
    currency: 'USD',
    buckets: [{ start: '2026-11-09T00:00:00Z', costUsd: 1.25 }],
  };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Response.json(body);
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { cognition: 'https://cognition.test' },
  });

  const spend = await macro.users
    .byId('macro|agent@example.com')
    .spend({ bucket: 'week' });

  expect(spend).toEqual(body);
  expect(requests.map((request) => request.url)).toEqual([
    'https://cognition.test/ai-cost/agents/macro%7Cagent%40example.com/spend?bucket=week',
  ]);
});
