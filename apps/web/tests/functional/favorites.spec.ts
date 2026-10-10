import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { buildSchema, graphql } from 'graphql';
import type {} from './favorites/fixture';

const schema = buildSchema(
  readFileSync(
    new URL('../../../../static_assets/schema.graphql', import.meta.url),
    'utf8'
  )
);

type ServerFavorite = { type: string; id: string; sortOrder: number };
type FavoritesFilter = { entityTypes?: string[]; entityIds?: string[] } | null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const graphqlFavorite = ({ type, id, sortOrder }: ServerFavorite) => ({
  __typename: 'GraphqlFavorite',
  id: `${type.toLowerCase()}:${id}`,
  entityType: type,
  entityId: id,
  sortOrder,
  createdAt: '2026-10-01T00:00:00.000Z',
  // Only the list resolver hydrates display metadata.
  fileType: null,
  documentSubType: null,
  channelType: type === 'CHANNEL' ? 'public' : null,
  channelId: null,
});

/** The real schema and documents; only server state and timing are controlled. */
async function mount(page: Page, initial: ServerFavorite[]) {
  const origin = test.info().project.use.baseURL;
  let favorites = [...initial];
  const mutations: Array<{ reply: (outcome: 'commit' | 'reject') => void }> =
    [];
  const reads: FavoritesFilter[] = [];
  const unexpected: string[] = [];
  page.on('pageerror', (error) => unexpected.push(error.message));
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      await route.abort();
      return;
    }
    if (
      /^\/(auth|cognition|contacts|dss|email|notification|connection-gateway)\//.test(
        url.pathname
      )
    ) {
      await route.fulfill({ json: {} });
      return;
    }
    await route.fulfill({ response: await route.fetch() });
  });
  await page.route('**/dss/items/soup/graphql', async (route) => {
    const request = route.request().postDataJSON() as {
      query: string;
      operationName: string;
      variables: Record<string, unknown>;
    };
    if (request.operationName === 'Favorites')
      reads.push((request.variables.filter as FavoritesFilter) ?? null);
    if (request.operationName === 'SetFavorite') {
      const response = deferred<'commit' | 'reject'>();
      mutations.push({ reply: response.resolve });
      if ((await response.promise) === 'reject') {
        await route.fulfill({
          json: { errors: [{ message: 'not authorized to update favorites' }] },
        });
        return;
      }
    }
    const rootValue = {
      user: {
        id: 'functional-viewer',
        favorites: ({ filter }: { filter: FavoritesFilter }) =>
          favorites
            .filter(
              ({ type, id }) =>
                (!filter?.entityTypes?.length ||
                  filter.entityTypes.includes(type)) &&
                (!filter?.entityIds?.length || filter.entityIds.includes(id))
            )
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(graphqlFavorite),
      },
      setFavorite: ({
        entity,
        favorite,
      }: {
        entity: { type: string; id: string };
        favorite: boolean;
      }) => {
        const existing = favorites.find(
          ({ type, id }) => type === entity.type && id === entity.id
        );
        favorites = favorites.filter((row) => row !== existing);
        // The server appends after the user's highest sort order.
        const added = favorite
          ? (existing ?? {
              type: entity.type,
              id: entity.id,
              sortOrder:
                Math.max(-1, ...favorites.map(({ sortOrder }) => sortOrder)) +
                1,
            })
          : undefined;
        if (added) favorites.push(added);
        return {
          result: { __typename: 'GraphqlMutationSuccess', effects: [] },
          favorite: added ? graphqlFavorite(added) : null,
        };
      },
    };
    const result = await graphql({
      schema,
      source: request.query,
      rootValue,
      variableValues: request.variables,
      operationName: request.operationName,
    });
    if (result.errors)
      unexpected.push(...result.errors.map(({ message }) => message));
    await route.fulfill({ json: result });
  });
  await page.goto('/tests/functional/favorites/index.html');
  await expect(page.getByTestId('ready')).toHaveText('ready');
  expect(await page.evaluate(() => window.favorites.hasCache())).toBe(true);
  return { mutations, reads, unexpected };
}

async function expectLists(
  page: Page,
  lists: { all?: string[]; documents?: string[]; channels?: string[] }
) {
  for (const [list, ids] of Object.entries(lists))
    await expect(page.getByTestId(list)).toHaveText(ids.join(','));
}

const INITIAL = [
  { type: 'DOCUMENT', id: 'doc-a', sortOrder: 0 },
  { type: 'CHANNEL', id: 'chan-b', sortOrder: 1 },
];

test('a favorite toggle reaches every mounted list at once, in sort order, without list recipes', async ({
  page,
}) => {
  const server = await mount(page, INITIAL);
  await expectLists(page, {
    all: ['document:doc-a', 'channel:chan-b'],
    documents: ['document:doc-a'],
    channels: ['channel:chan-b'],
  });
  const reads = server.reads.length;
  await page.evaluate(() =>
    window.favorites.toggle({ entityType: 'document', entityId: 'doc-c' }, true)
  );
  // Before the server answers, each list derives the predicted record.
  await expectLists(page, {
    all: ['document:doc-a', 'channel:chan-b', 'document:doc-c'],
    documents: ['document:doc-a', 'document:doc-c'],
    channels: ['channel:chan-b'],
  });
  await expect.poll(() => server.mutations.length).toBe(1);
  expect(server.reads).toHaveLength(reads);
  server.mutations[0].reply('commit');
  await expect
    .poll(() => page.evaluate(() => window.favorites.settled()))
    .toEqual([{ ok: true }]);
  // One read refreshes the added record's display metadata; lists stay put.
  await expect.poll(() => server.reads.length).toBe(reads + 1);
  expect(server.reads.at(-1)).toEqual({
    entityTypes: ['DOCUMENT'],
    entityIds: ['doc-c'],
  });
  await expectLists(page, {
    all: ['document:doc-a', 'channel:chan-b', 'document:doc-c'],
    documents: ['document:doc-a', 'document:doc-c'],
  });

  await page.evaluate(() =>
    window.favorites.toggle(
      { entityType: 'document', entityId: 'doc-a' },
      false
    )
  );
  await expectLists(page, {
    all: ['channel:chan-b', 'document:doc-c'],
    documents: ['document:doc-c'],
    channels: ['channel:chan-b'],
  });
  await expect.poll(() => server.mutations.length).toBe(2);
  server.mutations[1].reply('commit');
  await expect
    .poll(() => page.evaluate(() => window.favorites.settled().length))
    .toBe(2);
  await expectLists(page, {
    all: ['channel:chan-b', 'document:doc-c'],
    documents: ['document:doc-c'],
  });
  expect(server.unexpected).toEqual([]);
});

test('a rejected favorite rolls back in every mounted list', async ({
  page,
}) => {
  const server = await mount(page, INITIAL);
  await page.evaluate(() =>
    window.favorites.toggle({ entityType: 'channel', entityId: 'chan-d' }, true)
  );
  await expectLists(page, {
    all: ['document:doc-a', 'channel:chan-b', 'channel:chan-d'],
    channels: ['channel:chan-b', 'channel:chan-d'],
    documents: ['document:doc-a'],
  });
  await expect.poll(() => server.mutations.length).toBe(1);
  server.mutations[0].reply('reject');
  await expect
    .poll(() => page.evaluate(() => window.favorites.settled()))
    .toEqual([{ ok: false }]);
  await expectLists(page, {
    all: ['document:doc-a', 'channel:chan-b'],
    channels: ['channel:chan-b'],
    documents: ['document:doc-a'],
  });
  expect(server.unexpected).toEqual([]);
});

test('a favorite written by another source appears in watched lists without a refetch', async ({
  page,
}) => {
  const server = await mount(page, INITIAL);
  const reads = server.reads.length;
  await page.evaluate(() =>
    window.favorites.push({
      entityType: 'document',
      entityId: 'doc-e',
      sortOrder: 0.5,
    })
  );
  await expectLists(page, {
    all: ['document:doc-a', 'document:doc-e', 'channel:chan-b'],
    documents: ['document:doc-a', 'document:doc-e'],
    channels: ['channel:chan-b'],
  });
  expect(server.reads).toHaveLength(reads);
  expect(server.unexpected).toEqual([]);
});

// FAVORITES_TIMINGS=1: enqueue-to-last-list-update for a toggle, while the
// server holds the mutation, so only the optimistic path is measured.
test('favorite toggle timings', async ({ page }) => {
  test.skip(!process.env.FAVORITES_TIMINGS, 'opt-in timing run');
  const rows = Number(process.env.FAVORITES_TIMING_ROWS ?? 50);
  const initial = Array.from({ length: rows }, (_, index) => ({
    type: index % 5 === 0 ? 'CHANNEL' : 'DOCUMENT',
    id: `row-${index}`,
    sortOrder: index,
  }));
  const server = await mount(page, initial);
  const ids = initial.map(({ type, id }) => `${type.toLowerCase()}:${id}`);
  const samples: number[] = [];
  for (let sample = 0; sample < 21; sample++) {
    const added = `doc-timing-${sample}`;
    const expected = [...ids, `document:${added}`];
    samples.push(
      await page.evaluate(
        ({ added, expected }) =>
          window.favorites.timeToggle(
            { entityType: 'document', entityId: added },
            true,
            { all: expected }
          ),
        { added, expected }
      )
    );
    await expect.poll(() => server.mutations.length).toBe(sample + 1);
    server.mutations[sample].reply('commit');
    await expect
      .poll(() => page.evaluate(() => window.favorites.settled().length))
      .toBe(sample + 1);
    ids.push(`document:${added}`);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `favorite toggle, ${rows} mounted rows: median ${samples[samples.length >> 1].toFixed(1)} ms (min ${samples[0].toFixed(1)}, max ${samples.at(-1)?.toFixed(1)})`
  );
});
