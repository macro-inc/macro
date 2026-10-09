import {
  createGraphqlAddFavoriteMutation,
  createGraphqlFavoritesQuery,
  createGraphqlRemoveFavoriteMutation,
} from '@queries/favorites/graphql';
import type { FavoriteEntityType } from '@service-storage/generated/schemas/favoriteEntityType';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import { createComputed } from 'solid-js';
import { render } from 'solid-js/web';

/** Mounted lists: every favorite, documents only, and channels only. */
const LISTS = ['all', 'documents', 'channels'] as const;
type List = (typeof LISTS)[number];
type Favorite = { entityType: FavoriteEntityType; entityId: string };

/** When each list last changed, for enqueue-to-update timings. */
const changedAt: Record<List, number> = { all: 0, documents: 0, channels: 0 };
const settled: Array<{ ok: boolean }> = [];
let read: () => Record<List, string[]>;
let add: (favorite: Favorite) => Promise<unknown>;
let remove: (favorite: Favorite) => Promise<unknown>;

function Readers() {
  const queries = {
    all: createGraphqlFavoritesQuery(),
    documents: createGraphqlFavoritesQuery({ entityType: ['document'] }),
    channels: createGraphqlFavoritesQuery({ entityType: ['channel'] }),
  };
  const ids = (list: List) =>
    (queries[list].data?.favorites ?? []).map(
      ({ entityType, entityId }) => `${entityType}:${entityId}`
    );
  read = () => ({
    all: ids('all'),
    documents: ids('documents'),
    channels: ids('channels'),
  });
  for (const list of LISTS) {
    let previous = '';
    createComputed(() => {
      const next = ids(list).join(',');
      if (next !== previous) changedAt[list] = performance.now();
      previous = next;
    });
  }
  const addMutation = createGraphqlAddFavoriteMutation();
  const removeMutation = createGraphqlRemoveFavoriteMutation();
  const track = async (action: Promise<unknown>) => {
    try {
      await action;
      settled.push({ ok: true });
    } catch {
      settled.push({ ok: false });
    }
  };
  add = (favorite) => track(addMutation.mutateAsync(favorite));
  remove = (favorite) => track(removeMutation.mutateAsync(favorite));
  return (
    <>
      {LISTS.map((list) => (
        <output data-testid={list}>{ids(list).join(',')}</output>
      ))}
      <output data-testid="ready">
        {LISTS.every((list) => queries[list].data) ? 'ready' : 'loading'}
      </output>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing functional test root');
render(() => <Readers />, root);

/** Resolves once every list in `expected` shows exactly those favorites. */
async function until(expected: Partial<Record<List, string[]>>) {
  const matches = () => {
    const current = read();
    return Object.entries(expected).every(
      ([list, ids]) => current[list as List].join(',') === ids.join(',')
    );
  };
  while (!matches()) await new Promise((resolve) => setTimeout(resolve, 0));
}

const api = {
  read: () => read(),
  settled: () => settled,
  hasCache: () => !!getGraphqlCacheHost(),
  /** Toggles a favorite; resolves when the mutation settles. */
  toggle(favorite: Favorite, on: boolean) {
    void (on ? add(favorite) : remove(favorite));
  },
  /**
   * Enqueues a toggle and measures until every listed expectation is
   * visible, from the mutation call to the last list update.
   */
  async timeToggle(
    favorite: Favorite,
    on: boolean,
    expected: Partial<Record<List, string[]>>
  ) {
    const started = performance.now();
    void (on ? add(favorite) : remove(favorite));
    await until(expected);
    const lists = Object.keys(expected) as List[];
    return Math.max(...lists.map((list) => changedAt[list])) - started;
  },
  /**
   * A server write of one favorite that no mounted list fetched, such as a
   * push or another tab's committed mutation.
   */
  async push(favorite: Favorite & { sortOrder: number }) {
    const host = getGraphqlCacheHost();
    if (!host) throw new Error('expected an active cache');
    await host.writeQuery({
      query: `mutation PushedFavorite {
        setFavorite(entity: {type: DOCUMENT, id: "pushed"}, favorite: true) {
          favorite {
            __typename id entityType entityId sortOrder createdAt
            fileType documentSubType channelType channelId
          }
        }
      }`,
      operationName: 'PushedFavorite',
      variables: {},
      data: {
        setFavorite: {
          favorite: {
            __typename: 'GraphqlFavorite',
            id: `${favorite.entityType}:${favorite.entityId}`,
            entityType: favorite.entityType.toUpperCase(),
            entityId: favorite.entityId,
            sortOrder: favorite.sortOrder,
            createdAt: '2026-10-01T00:00:00.000Z',
            fileType: null,
            documentSubType: null,
            channelType: null,
            channelId: null,
          },
        },
      },
    });
  },
};
declare global {
  interface Window {
    favorites: typeof api;
  }
}
window.favorites = api;
