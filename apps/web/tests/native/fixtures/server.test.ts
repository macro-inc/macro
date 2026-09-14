import { afterEach, expect, test } from 'bun:test';
import { print, visit } from 'graphql';
import { SoupMailBackfillDocument } from '../../../src/lib/service-clients/service-storage/graphql/generated/graphql';
import { fixtureId } from './mail';
import { startFixtureServer } from './server';

let server: ReturnType<typeof startFixtureServer> | undefined;
afterEach(async () => {
  await server?.disconnect();
});

const query = print(
  visit(SoupMailBackfillDocument, {
    Directive(node) {
      return node.name.value === 'cacheOnly' ? null : undefined;
    },
  })
);

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

test('unknown endpoints fail closed; disconnect removes the TCP listener', async () => {
  server = startFixtureServer();
  expect((await fetch(`${server.origin}/unimplemented`)).status).toBe(501);
  await server.disconnect();
  await expect(fetch(`${server.origin}/health`)).rejects.toThrow();
});

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
