import { afterEach, expect, test } from 'bun:test';
import { type DocumentNode, type ExecutionResult, print, visit } from 'graphql';
import {
  SoupDocument,
  type SoupInput,
  SoupMailBackfillDocument,
  type SoupQuery,
} from '../../../src/lib/service-clients/service-storage/graphql/generated/graphql';
import { fixtureId } from './mail';
import { startFixtureServer } from './server';

let server: ReturnType<typeof startFixtureServer> | undefined;
afterEach(async () => {
  await server?.disconnect();
});

function transportQuery(document: DocumentNode): string {
  return print(
    visit(document, {
      Directive(node) {
        return node.name.value === 'cacheOnly' ? null : undefined;
      },
    })
  );
}

const query = transportQuery(SoupMailBackfillDocument);
const soupQuery = transportQuery(SoupDocument);

async function requestSoup(
  input: SoupInput
): Promise<ExecutionResult<SoupQuery>> {
  if (!server) throw new Error('Fixture server must be started first');
  const response = await fetch(`${server.origin}/dss/items/soup/graphql`, {
    method: 'POST',
    body: JSON.stringify({
      query: soupQuery,
      operationName: 'Soup',
      variables: { input },
    }),
  });
  return await response.json();
}

test('real generated backfill document validates, pages, and includes projection/preview metadata', async () => {
  server = startFixtureServer();
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const response = await fetch(`${server.origin}/dss/items/soup/graphql`, {
      method: 'POST',
      body: JSON.stringify({
        query,
        operationName: 'SoupMailBackfill',
        variables: {
          input: cursor
            ? { continuation: { cursor, emailView: 'ALL' } }
            : { initial: { limit: 100, emailView: 'ALL' } },
        },
      }),
    });
    const result: {
      errors?: unknown;
      data: {
        user: {
          soup: {
            items: {
              id: string;
              cacheProjection: string;
              mailAllPreview: { subject: string };
            }[];
            nextCursor: string | null;
          };
        };
      };
    } = await response.json();
    expect(result.errors).toBeUndefined();
    const soup = result.data.user.soup;
    expect(soup.items).toHaveLength(2);
    for (const item of soup.items) {
      ids.push(item.id);
      expect(item.cacheProjection).toBeString();
      expect(item.mailAllPreview.subject).toStartWith('Email ');
    }
    cursor = soup.nextCursor;
    if (page < 2) expect(cursor).toBeString();
  }
  expect(cursor).toBeNull();
  expect(ids).toEqual([4, 6, 8, 9, 10, 12].map(fixtureId));
  expect(server.metadataPagesServed).toBe(3);
});

const signalTree = {
  and: {
    left: { literal: { importance: true } },
    right: { literal: { shared: 'EXCLUDE' } },
  },
} as const;

test('accepts the initial Signal INBOX query with both email predicates', async () => {
  server = startFixtureServer();
  const result = await requestSoup({
    initial: {
      emailView: 'INBOX',
      filters: { emailFilter: { tree: signalTree } },
    },
  });
  expect(result.errors).toBeUndefined();
  expect(result.data?.user.soup.items.map((item) => item.id)).toEqual([
    fixtureId(6),
    fixtureId(12),
  ]);
});

const invalidSignalInputs: Array<[string, SoupInput]> = [
  [
    'importance only in the channel branch',
    {
      initial: {
        emailView: 'INBOX',
        filters: {
          channelFilter: { literal: { importance: true } },
          emailFilter: {
            tree: {
              and: {
                left: { literal: { importance: false } },
                right: { literal: { shared: 'EXCLUDE' } },
              },
            },
          },
        },
      },
    },
  ],
  [
    'missing shared exclusion',
    {
      initial: {
        emailView: 'INBOX',
        filters: { emailFilter: { tree: { literal: { importance: true } } } },
      },
    },
  ],
  [
    'shared INCLUDE',
    {
      initial: {
        emailView: 'INBOX',
        filters: {
          emailFilter: {
            tree: {
              and: {
                left: { literal: { importance: true } },
                right: { literal: { shared: 'INCLUDE' } },
              },
            },
          },
        },
      },
    },
  ],
  [
    'shared ONLY',
    {
      initial: {
        emailView: 'INBOX',
        filters: {
          emailFilter: {
            tree: {
              and: {
                left: { literal: { importance: true } },
                right: { literal: { shared: 'ONLY' } },
              },
            },
          },
        },
      },
    },
  ],
  [
    'negated importance',
    {
      initial: {
        emailView: 'INBOX',
        filters: {
          emailFilter: { tree: { not: { literal: { importance: true } } } },
        },
      },
    },
  ],
  [
    'ALL rather than INBOX',
    {
      initial: {
        emailView: 'ALL',
        filters: { emailFilter: { tree: signalTree } },
      },
    },
  ],
  ['missing filters', { initial: { emailView: 'INBOX' } }],
];

for (const [name, input] of invalidSignalInputs) {
  test(`rejects non-Signal online query: ${name}`, async () => {
    server = startFixtureServer();
    const result = await requestSoup(input);
    expect(result.errors?.map((error) => error.message)).toEqual([
      'Only the initial Signal view may be fetched online',
    ]);
    expect(result.data?.user?.soup?.items ?? []).toEqual([]);
  });
}

test('unknown endpoints fail closed; disconnect removes the TCP listener', async () => {
  server = startFixtureServer();
  expect((await fetch(`${server.origin}/unimplemented`)).status).toBe(501);
  await server.disconnect();
  await expect(fetch(`${server.origin}/health`)).rejects.toThrow();
});

test('disconnect closes live WebSockets and finishes shutdown', async () => {
  server = startFixtureServer();
  const socket = new WebSocket(
    server.origin.replace('http', 'ws') + '/connection-gateway'
  );
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = reject;
  });
  expect(server.socketCount).toBe(1);
  const closed = new Promise<void>((resolve) => {
    socket.onclose = () => resolve();
  });
  await server.disconnect();
  await closed;
  expect(server.socketCount).toBe(0);
}, 3000);

test('invalid cursors fail rather than silently completing the scan', async () => {
  server = startFixtureServer();
  const response = await fetch(`${server.origin}/dss/items/soup/graphql`, {
    method: 'POST',
    body: JSON.stringify({
      query,
      operationName: 'SoupMailBackfill',
      variables: { input: { continuation: { cursor: 'invalid' } } },
    }),
  });
  expect((await response.json()).errors[0].message).toBe(
    'Unknown metadata cursor'
  );
});
