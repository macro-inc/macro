import { createHash } from 'node:crypto';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  LiveQuery,
  querySnapshot,
} from '../../../graphql-cache/exchange/live-query';
import { applyQueryPatches } from '../../../graphql-cache/exchange/query-patches';
import type { GroupSoupQuery } from '../../../service-clients/service-storage/graphql/generated/graphql';
import type { GraphqlSoupItem } from '../../../service-clients/service-storage/graphql-soup';
import { createKeyedProjection } from '../create-keyed-projection';

const mapItem = vi.hoisted(() =>
  vi.fn((item: GraphqlSoupItem) => ({
    id: item.id,
    name: 'documentName' in item ? item.documentName : undefined,
  }))
);
vi.mock('../../../service-clients/service-storage/graphql-soup', () => ({
  mapGraphqlSoupItem: mapItem,
}));
vi.mock('../transform-utils', () => ({
  mapSoupPageToEntityList: (page: { items: unknown[] }) => page.items,
}));
vi.mock('../grouped/api', () => ({
  makeGroupComparator: () => (a: { key: string }, b: { key: string }) =>
    a.key.localeCompare(b.key),
  resolveGroupMetaForKey: (_field: unknown, key: string) => ({ label: key }),
}));

import { createGraphqlGroupedSoupProjection } from './grouped-projection';
import { plainSoupRecord } from './plain-record';
import { soupItemKey } from './reconciliation';

type Row = GroupSoupQuery['user']['groupSoup']['bins'][number]['items'][number];

function row(id: number): Row {
  return {
    __typename: 'GraphqlSoupDocument',
    appearance: null,
    id: String(id),
    entityType: 'DOCUMENT',
    displayName: String(id),
    documentName: String(id),
    ownerId: 'viewer',
    cacheProjection: null,
    frecencyScore: null,
    fileType: 'md',
    projectId: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    viewedAt: null,
    deletedAt: null,
    subType: { __typename: 'GraphqlTaskSubType', isCompleted: false },
    isFavorited: false,
    notifications: [],
    properties: [],
  } as Row;
}

const flat = (count: number, identifiedUser = false) => ({
  user: {
    ...(identifiedUser ? { __typename: 'User' } : {}),
    id: 'viewer',
    soup: {
      __typename: 'SoupPage',
      items: Array.from({ length: count }, (_, id) => row(id)),
    },
  },
});

const grouped = (count: number): GroupSoupQuery =>
  ({
    user: {
      id: 'viewer',
      groupSoup: {
        bins: [
          {
            key: 'a',
            displayOrder: null,
            label: null,
            totalCount: count,
            nextCursor: null,
            items: Array.from({ length: count }, (_, id) => row(id)),
          },
        ],
      },
    },
  }) as GroupSoupQuery;

type Step = { name: string; maps: number; ms: number };
const reps = 15;

/**
 * Feeds one server result sequence through a Soup projection: (a) a field
 * patch, (b) a reorder that replaces the list, (c) a refetch with nothing
 * changed, (d) every row changed. Counts mapper runs per step.
 */
function run(
  kind: 'keyed' | 'grouped',
  count: number,
  identifiedUser = false
): { steps: Step[]; initial: number } {
  return createRoot((dispose) => {
    try {
      mapItem.mockClear();
      const data =
        kind === 'keyed' ? flat(count, identifiedUser) : grouped(count);
      const view = new LiveQuery(data as Record<string, unknown>, undefined);
      const items = (snapshot: unknown) =>
        kind === 'keyed'
          ? (snapshot as ReturnType<typeof flat>).user.soup.items
          : (snapshot as GroupSoupQuery).user.groupSoup.bins[0].items;
      const listPath =
        kind === 'keyed'
          ? ['user', 'soup', 'items']
          : ['user', 'groupSoup', 'bins', 0, 'items'];
      const projected =
        kind === 'keyed'
          ? createKeyedProjection(
              () => items(querySnapshot(view.data)) as GraphqlSoupItem[],
              soupItemKey,
              (record) => mapItem(plainSoupRecord(record))
            )
          : createGraphqlGroupedSoupProjection(
              () => querySnapshot(view.data) as GroupSoupQuery,
              () => ({ type: 'property', propertyDefinitionId: 'status' }),
              () => ({})
            );
      projected();
      const initial = mapItem.mock.calls.length;
      const steps: Step[] = [];
      // Each step runs `reps` times; `maps` is the mapper runs of every run
      // (-1 if they differ) and `ms` the median, update to projection read.
      const step = (name: string, apply: (rep: number) => void) => {
        const maps = new Set<number>();
        const durations: number[] = [];
        for (let rep = 0; rep < reps; rep++) {
          const before = mapItem.mock.calls.length;
          const started = performance.now();
          apply(rep);
          projected();
          durations.push(performance.now() - started);
          maps.add(mapItem.mock.calls.length - before);
        }
        durations.sort((a, b) => a - b);
        steps.push({
          name,
          maps: maps.size === 1 ? [...maps][0] : -1,
          ms: durations[Math.floor(reps / 2)],
        });
      };
      step('a. one field patched', (rep) =>
        view.replace(
          applyQueryPatches(view.snapshot, [
            {
              path: [...listPath, 5 + rep, 'documentName'],
              value: `renamed ${rep}`,
            },
          ])
        )
      );
      step('b. list replaced by a reorder', () => {
        const list = [...(items(view.snapshot) as Row[])];
        list.unshift(...list.splice(count - 1, 1));
        view.replace(
          applyQueryPatches(view.snapshot, [
            { path: listPath, value: structuredClone(list) },
          ])
        );
      });
      step('c. refetch, nothing changed', () =>
        view.replace(structuredClone(view.snapshot))
      );
      step('d. every row changed', (rep) => {
        const next = structuredClone(view.snapshot);
        const updatedAt = `2026-11-01T00:00:${String(rep).padStart(2, '0')}Z`;
        for (const item of items(next) as Row[])
          (item as { updatedAt: string }).updatedAt = updatedAt;
        view.replace(next);
      });
      return { steps, initial };
    } finally {
      dispose();
    }
  });
}

describe('Soup rows by identity', () => {
  it.each([
    ['keyed', 1_000],
    ['keyed', 2_000],
    ['grouped', 1_000],
    ['grouped', 2_000],
  ] as const)(
    'maps only the rows a %s result changed, at %i rows',
    (kind, count) => {
      const { steps, initial } = run(kind, count);
      process.stderr.write(
        `BENCH ${JSON.stringify({ kind, count, initial, steps })}\n`
      );
      expect(initial).toBe(count);
      expect(steps.map((entry) => entry.maps)).toEqual([1, 0, 0, count]);
    }
  );

  // Row versions used to bump only the first identified object on a path, so
  // rows under an identified parent missed every full result.
  it('maps every row a full result changed under an identified parent', () => {
    const { steps } = run('keyed', 1_000, true);
    expect(steps.map((entry) => entry.maps)).toEqual([1, 0, 0, 1_000]);
  });
});

// Relative to apps/web, where vitest runs.
const FIXTURES = 'src/lib/queries/soup/graphql/row-identity.fixtures.json';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

function random(seed: number) {
  let state = seed;
  return (bound: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return (((value ^ (value >>> 14)) >>> 0) % bound) as number;
  };
}

/**
 * A seeded sequence of patched and full results through each projection,
 * recording what it shows after every step. The fixtures were recorded on the
 * row-version build this replaced; both must show the same entities.
 */
function differential(kind: 'keyed' | 'grouped', seed: number): string[] {
  return createRoot((dispose) => {
    try {
      const next = random(seed);
      const view = new LiveQuery(
        (kind === 'keyed' ? flat(40) : grouped(40)) as Record<string, unknown>,
        undefined
      );
      const listPath =
        kind === 'keyed'
          ? ['user', 'soup', 'items']
          : ['user', 'groupSoup', 'bins', 0, 'items'];
      const list = (snapshot: unknown) =>
        listPath.reduce<unknown>(
          (value, part) => (value as Record<string | number, unknown>)[part],
          snapshot
        ) as Row[];
      const projected =
        kind === 'keyed'
          ? createKeyedProjection(
              () => list(querySnapshot(view.data)) as GraphqlSoupItem[],
              soupItemKey,
              (record) => mapItem(plainSoupRecord(record))
            )
          : createGraphqlGroupedSoupProjection(
              () => querySnapshot(view.data) as GroupSoupQuery,
              () => ({ type: 'property', propertyDefinitionId: 'status' }),
              () => ({})
            );
      const shown = [digest(projected())];
      const replaceList = (rows: Row[]) =>
        view.replace(
          applyQueryPatches(view.snapshot, [
            { path: listPath, value: structuredClone(rows) },
          ])
        );
      for (let step = 0; step < 300; step++) {
        const rows = [...list(view.snapshot)];
        const at = rows.length ? next(rows.length) : 0;
        switch (next(5)) {
          case 0:
            if (rows.length)
              view.replace(
                applyQueryPatches(view.snapshot, [
                  {
                    path: [...listPath, at, 'documentName'],
                    value: `renamed ${step}`,
                  },
                ])
              );
            break;
          case 1:
            rows.splice(at, 0, row(1_000 + step));
            replaceList(rows);
            break;
          case 2:
            rows.splice(at, 1);
            replaceList(rows);
            break;
          case 3: {
            const other = rows.length ? next(rows.length) : 0;
            [rows[at], rows[other]] = [rows[other], rows[at]];
            replaceList(rows);
            break;
          }
          default: {
            const full = structuredClone(view.snapshot);
            const items = list(full);
            if (items.length && next(2))
              (items[at] as { documentName: string }).documentName =
                `refetched ${step}`;
            view.replace(full);
          }
        }
        shown.push(digest(projected()));
      }
      return shown;
    } finally {
      dispose();
    }
  });
}

describe('Soup rows by identity, against row versions', () => {
  it('shows what the row-version build showed for every seeded result', async () => {
    const shown = Object.fromEntries(
      (['keyed', 'grouped'] as const).flatMap((kind) =>
        [1, 2, 3].map((seed) => [`${kind} ${seed}`, differential(kind, seed)])
      )
    );
    const { readFile, writeFile } = await import('node:fs/promises');
    if (process.env.RECORD_ROW_IDENTITY_FIXTURES) {
      await writeFile(FIXTURES, `${JSON.stringify(shown, null, 1)}\n`);
      return;
    }
    expect(shown).toEqual(JSON.parse(await readFile(FIXTURES, 'utf8')));
  });
});
