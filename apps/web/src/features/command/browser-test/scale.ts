import { searchQuickAccessItems } from '@core/context/quickAccess/entity-search';
import type { EntityItem } from '@core/context/quickAccess/types';
import { createWorkerCacheHost } from '@graphql-cache/host/worker-host';
import { materializeCachedGraphqlHistoryItems } from '@queries/history/graphql';
import { rankCommandSearchItems } from '../rank-command-search-items';

const query = `query Seed($input: SoupInput!) { user { id soup(input: $input) { items { __typename id ... on GraphqlSoupDocument { name fileType ownerId createdAt updatedAt viewedAt deletedAt subType { __typename } } } } } }`;
const now = Date.now();
const words = [
  'Project roadmap',
  'Release planning',
  'Team design notes',
  'Weekly status',
  'Product research',
  'Launch checklist',
  'Meeting notes',
  'Budget report',
];
let items: EntityItem[] = [];
let host: ReturnType<typeof createWorkerCacheHost> | undefined;
const status = document.querySelector('#status')!;
const samples = [
  'p',
  'pr',
  'pro',
  'proj',
  'project',
  'project r',
  'r',
  're',
  'rel',
  'release',
  'tea',
  'team',
  'notes',
  'launch',
  'design',
  'research',
  'budget',
  'zzzz',
];

const api = {
  instance: crypto.randomUUID(),
  candidates: () => items,
  async seed(size: number) {
    host?.dispose();
    host = createWorkerCacheHost({
      scope: `command-scale-${crypto.randomUUID()}`,
    });
    items = [];
    const start = performance.now();
    for (let i = 0; i < size; i++) {
      const id = `scale-${String(i).padStart(6, '0')}`,
        name = `${words[i % words.length]} ${i}`;
      const viewedAt = new Date(now - i * 60000).toISOString();
      items.push({
        kind: 'entity',
        id,
        bucket: 'note',
        searchText: name,
        sortTimestamp: now - i * 60000,
        timestamps: { viewedAt, updatedAt: viewedAt },
        data: {
          id,
          type: 'document',
          name,
          fileType: 'md',
          ownerId: 'fixture-owner',
        },
      });
    }
    const buildMs = performance.now() - start;
    const seedStart = performance.now();
    for (let offset = 0; offset < size; offset += 500) {
      const data = items.slice(offset, offset + 500).map((i) => ({
        __typename: 'GraphqlSoupDocument',
        id: i.id,
        name: i.searchText,
        fileType: 'md',
        ownerId: 'fixture-owner',
        createdAt: i.timestamps.viewedAt,
        updatedAt: i.timestamps.viewedAt,
        viewedAt: i.timestamps.viewedAt,
        deletedAt: null,
        subType: null,
      }));
      await host.writeQuery({
        query,
        variables: { input: { initial: { limit: offset + 1 } } },
        data: { user: { id: 'fixture-owner', soup: { items: data } } },
      });
    }
    return {
      instance: api.instance,
      size,
      buildMs,
      seedMs: performance.now() - seedStart,
    };
  },
  rank(query: string) {
    const start = performance.now();
    const candidates = searchQuickAccessItems(items, query);
    const filtered = performance.now();
    const ranked = rankCommandSearchItems(candidates, query, {
      preserveAdditionalEntityMatches: true,
    });
    return {
      filterMs: filtered - start,
      rankMs: performance.now() - filtered,
      totalMs: performance.now() - start,
      count: ranked.length,
      ids: ranked.slice(0, 20).map((i) => i.id),
    };
  },
  async engine(query: string) {
    if (!host) throw Error('seed first');
    const start = performance.now();
    const page = await host.search({
      profile: 'quick-access-v1',
      buckets: ['note'],
      query,
      limit: 500,
    });
    const searched = performance.now();
    const materialized = await materializeCachedGraphqlHistoryItems(
      host,
      page.documents
    );
    if (materialized.length !== page.documents.length)
      throw Error('Incomplete cache projection');
    return {
      searchMs: searched - start,
      materializeMs: performance.now() - searched,
      count: materialized.length,
    };
  },
  samples,
};
Object.assign(window, { commandScale: api });
status.textContent = 'ready';
window.addEventListener('pagehide', () => host?.dispose(), { once: true });
