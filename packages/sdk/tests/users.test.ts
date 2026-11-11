import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('person search returns real contact identities, keeps ambiguous matches and seeds names', async () => {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (new URL(request.url).pathname === '/contacts')
        return Response.json({
          contacts: [
            'macro|alice@example.com',
            'macro|alice.other@example.com',
            'macro|bob@example.com',
            'macro|alice@example.com',
          ],
        });
      return Response.json({
        names: [
          {
            id: 'macro|alice@example.com',
            first_name: 'Alice',
            last_name: 'One',
          },
          {
            id: 'macro|alice.other@example.com',
            first_name: 'Alice',
            last_name: 'Two',
          },
          { id: 'macro|bob@example.com', first_name: 'Bob' },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { contacts: 'https://contacts.test', auth: 'https://auth.test' },
  });
  const matches = await macro.users.search('ALICE');
  expect(matches.map((user) => ({ id: user.id, email: user.email() }))).toEqual(
    [
      { id: 'macro|alice@example.com', email: 'alice@example.com' },
      { id: 'macro|alice.other@example.com', email: 'alice.other@example.com' },
    ],
  );
  expect(await Promise.all(matches.map((user) => user.name()))).toEqual([
    'Alice One',
    'Alice Two',
  ]);
  expect(requests).toHaveLength(2);
  expect(await requests[1].json()).toEqual({
    user_ids: [
      'macro|alice@example.com',
      'macro|alice.other@example.com',
      'macro|bob@example.com',
    ],
  });
  expect(
    requests.every(
      (request) => request.headers.get('x-macro-user-api-key') === 'mak_test',
    ),
  ).toBe(true);
});

test('an empty contact set is empty but authorization and service failures propagate', async () => {
  let status = 404;
  globalThis.fetch = Object.assign(
    async () => Response.json(null, { status }),
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { contacts: 'https://contacts.test' },
  });
  expect(await macro.users.search('Alice')).toEqual([]);
  status = 401;
  await expect(macro.users.search('Alice')).rejects.toThrow();
  status = 500;
  await expect(macro.users.search('Alice')).rejects.toThrow();
  await expect(macro.users.search('  ')).rejects.toThrow('name or email');
});
