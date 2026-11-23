import { describe, expect, test } from 'bun:test';
import type { MacroClient } from '../../utils/client';
import { UserNamespace } from './namespace';

type MembersRequest = {
  path: { list: string };
  query: { cursor?: string; limit?: number };
};

/**
 * A contacts service that serves `pages` of one list in order, each page's
 * cursor naming the next, and an auth service that names everyone but
 * `macro|unnamed@example.com`.
 */
function makeClient(pages: string[][]) {
  const calls = {
    members: [] as MembersRequest[],
    names: [] as string[][],
  };
  const client = {
    contacts: {
      listContactListMembers: async (request: MembersRequest) => {
        calls.members.push(request);
        const index = request.query.cursor ? Number(request.query.cursor) : 0;
        const next = index + 1 < pages.length ? String(index + 1) : null;
        return { data: { members: pages[index], nextCursor: next } };
      },
    },
    auth: {
      getUserNamesWithEmail: async ({
        body,
      }: {
        body: { user_ids: string[] };
      }) => {
        calls.names.push(body.user_ids);
        return {
          data: {
            names: body.user_ids
              .filter((id) => id !== 'macro|unnamed@example.com')
              .map((id) => ({
                id,
                first_name: id.slice(6, 7).toUpperCase(),
                last_name: null,
                is_agent: id.startsWith('macro|agent'),
              })),
          },
        };
      },
    },
  } as unknown as MacroClient;
  return { client, calls };
}

describe('contacts lists', () => {
  test('inList pages the list and names each page in one request', async () => {
    const { client, calls } = makeClient([
      ['macro|a@example.com', 'macro|agent@example.com'],
      ['macro|b@example.com'],
    ]);
    const people = [];
    for await (const person of new UserNamespace(client).inList('gmail', {
      pageSize: 2,
    }))
      people.push(person);

    expect(people.map((person) => person.email())).toEqual([
      'a@example.com',
      'agent@example.com',
      'b@example.com',
    ]);
    expect(await people[0]?.name()).toBe('A');
    expect(await people[1]?.isAgent()).toBe(true);
    expect(calls.members).toEqual([
      { path: { list: 'gmail' }, query: { cursor: undefined, limit: 2 } },
      { path: { list: 'gmail' }, query: { cursor: '1', limit: 2 } },
    ]);
    // Seeded names: reading them made no further name requests.
    expect(calls.names).toEqual([
      ['macro|a@example.com', 'macro|agent@example.com'],
      ['macro|b@example.com'],
    ]);
  });

  test('inList stops at maxItems without fetching another page', async () => {
    const { client, calls } = makeClient([
      ['macro|a@example.com', 'macro|b@example.com'],
      ['macro|c@example.com'],
    ]);
    const people = [];
    for await (const person of new UserNamespace(client).inList('interacted', {
      maxItems: 2,
    }))
      people.push(person);

    expect(people).toHaveLength(2);
    expect(calls.members).toHaveLength(1);
  });

  test('an empty page names nobody', async () => {
    const { client, calls } = makeClient([[]]);
    const people = [];
    for await (const person of new UserNamespace(client).inList('invited'))
      people.push(person);

    expect(people).toEqual([]);
    expect(calls.names).toEqual([]);
  });

  test('inList refuses an unknown list or option before any request', () => {
    const { client, calls } = makeClient([[]]);
    const users = new UserNamespace(client);
    expect(() => users.inList('friends' as unknown as 'gmail')).toThrow(
      /unknown list `friends`/,
    );
    expect(() =>
      users.inList('gmail', { limit: 5 } as unknown as { pageSize: number }),
    ).toThrow();
    expect(calls.members).toEqual([]);
  });

  test('teammates collects the teammates list, keeping unnamed people', async () => {
    const { client, calls } = makeClient([
      ['macro|a@example.com'],
      ['macro|unnamed@example.com'],
    ]);
    const teammates = await new UserNamespace(client).teammates();

    expect(teammates.map((user) => user.id)).toEqual([
      'macro|a@example.com',
      'macro|unnamed@example.com',
    ]);
    expect(calls.members.map((request) => request.path.list)).toEqual([
      'teammates',
      'teammates',
    ]);
    expect(calls.members[0]?.query.limit).toBe(500);
  });
});
