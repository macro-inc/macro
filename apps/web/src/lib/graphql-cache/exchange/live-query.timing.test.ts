// Opt-in main-thread timings for a Soup-like page: a full result (parse plus
// keyed reconcile) vs the patches cache-core sends for leaf, link and
// tombstone edits. Mirrors crates/client/cache-core/tests/watch_query_timing.rs.
// LIVE_QUERY_TIMINGS=1 bunx vitest run --project graphql-cache \
//   --reporter=default live-query.timing
import { gql } from '@urql/core';
import { createComputed, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { QueryFieldPatch } from '../protocol';
import { LiveQuery } from './live-query';
import { applyQueryPatches } from './query-patches';
import { queryShape } from './query-shape';

const SAMPLES = 200;
const WARMUP = 20;
const EDITED = 7;
const SHAPE = queryShape(gql`
  query Page($input: SoupInput!) {
    user { id soup(input: $input) { items {
      __typename id frecencyScore
      ... on GraphqlSoupDocument {
        documentName: name ownerId fileType projectId createdAt updatedAt viewedAt deletedAt
        subType { __typename ... on GraphqlTaskSubType { isCompleted } }
        properties { id propertyDefinitionId displayName dataType isMultiSelect value {
          __typename
          ... on GraphqlSelectOptionPropertyValue { optionIds }
          ... on GraphqlStringPropertyValue { value }
        } }
      }
    } nextCursor } }
  }
`);

type PropertyValue = {
  __typename: string;
  optionIds?: string[];
  value?: string;
};

const property = (id: string, definition: string, value: PropertyValue) => ({
  id,
  propertyDefinitionId: definition,
  displayName: definition,
  dataType: value.optionIds ? 'SELECT_STRING' : 'STRING',
  isMultiSelect: false,
  value,
});

const properties = (row: number) => [
  property(`status-${row}`, 'status', {
    __typename: 'GraphqlSelectOptionPropertyValue',
    optionIds: ['todo'],
  }),
  property(`note-${row}`, 'note', {
    __typename: 'GraphqlStringPropertyValue',
    value: 'note',
  }),
];

function page(rows: number) {
  const items = Array.from({ length: rows }, (_, i) => ({
    __typename: 'GraphqlSoupDocument',
    id: `doc-${i}`,
    frecencyScore: 0.5,
    documentName: `Document ${i}`,
    ownerId: 'macro|owner@example.com',
    fileType: 'md',
    projectId: i % 3 === 0 ? null : 'project-1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    viewedAt: '2026-10-03T00:00:00Z',
    deletedAt: null,
    subType: { __typename: 'GraphqlTaskSubType', isCompleted: false },
    properties: properties(i),
  }));
  return { user: { id: 'viewer', soup: { items, nextCursor: null } } };
}
type Page = ReturnType<typeof page>;

/** Like a rendered `<For>`: the list tracks rows, each row its own fields. */
function mount(rows: number): LiveQuery {
  return createRoot(() => {
    const view = new LiveQuery(page(rows), SHAPE);
    const items = () => (view.data as Page).user.soup.items;
    createComputed(() => {
      for (const item of items()) void item.id;
    });
    for (const item of items()) {
      createComputed(() => {
        void item.documentName;
        void item.updatedAt;
        void item.subType.isCompleted;
        for (const { value } of item.properties)
          void (value.optionIds?.join(',') ?? value.value);
      });
    }
    return view;
  });
}

/** Median microseconds per call. */
function median(run: (sample: number) => void): number {
  for (let sample = 0; sample < WARMUP; sample++) run(sample);
  const times: number[] = [];
  for (let sample = WARMUP; sample < WARMUP + SAMPLES; sample++) {
    const start = performance.now();
    run(sample);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1] * 1000;
}

/** Times parsing a transferred patch list and applying it to a mounted view. */
function timePatches(rows: number, payloads: (sample: number) => string) {
  const view = mount(rows);
  const encoded = Array.from({ length: WARMUP + SAMPLES }, (_, sample) =>
    payloads(sample)
  );
  const time = median((sample) => {
    const patches = JSON.parse(encoded[sample]) as QueryFieldPatch[];
    view.replace(applyQueryPatches(view.snapshot, patches));
  });
  return { time, bytes: encoded[0].length, view };
}

describe.skipIf(!process.env.LIVE_QUERY_TIMINGS)(
  'live query update timings',
  () => {
    it('prints full-result and patch costs', () => {
      const lines = [
        '| rows | update | main thread: parse + apply/reconcile | payload |',
        '|---:|---|---:|---:|',
      ];
      const us = (value: number) => `${value.toFixed(1)} µs`;
      for (const rows of [100, 500]) {
        const full = page(rows);
        const serialized = JSON.stringify(full);
        const hitView = mount(rows);
        const hit = median((sample) => {
          const next = JSON.parse(serialized) as Page;
          next.user.soup.items[(sample * 7) % rows].documentName =
            `Renamed ${sample}`;
          hitView.replace(next);
        });
        lines.push(
          `| ${rows} | full result, one field changed | ${us(hit)} | ${serialized.length} B |`
        );
        const shrunk = JSON.stringify({
          user: {
            ...full.user,
            soup: {
              ...full.user.soup,
              items: full.user.soup.items.filter((_, row) => row !== EDITED),
            },
          },
        });
        const membershipView = mount(rows);
        const membership = median((sample) =>
          membershipView.replace(
            JSON.parse(sample % 2 === 0 ? shrunk : serialized) as Page
          )
        );
        lines.push(
          `| ${rows} | full result, item tombstoned / restored | ${us(membership)} | ${shrunk.length} B |`
        );
        lines.push(
          `| ${rows} | structuredClone of full result (worker → page) | ${us(median(() => structuredClone(full)))} | |`
        );

        const leaf = timePatches(rows, (sample) =>
          JSON.stringify([
            {
              path: [
                'user',
                'soup',
                'items',
                (sample * 7) % rows,
                'documentName',
              ],
              value: `Renamed ${sample}`,
            },
          ])
        );
        const extra = property(`extra-${EDITED}`, 'extra', {
          __typename: 'GraphqlSelectOptionPropertyValue',
          optionIds: ['added'],
        });
        const linked = [...properties(EDITED), extra];
        const link = timePatches(rows, (sample) =>
          JSON.stringify([
            {
              path: ['user', 'soup', 'items', EDITED, 'properties'],
              value: sample % 2 === 0 ? linked : properties(EDITED),
            },
          ])
        );
        const remaining = full.user.soup.items.filter(
          (_, row) => row !== EDITED
        );
        const tombstone = timePatches(rows, (sample) =>
          JSON.stringify([
            {
              path: ['user', 'soup', 'items'],
              value: sample % 2 === 0 ? remaining : full.user.soup.items,
            },
          ])
        );
        expect(
          (link.view.data as Page).user.soup.items[EDITED].properties
        ).toHaveLength((WARMUP + SAMPLES) % 2 === 0 ? 2 : 3);
        expect((tombstone.view.data as Page).user.soup.items).toHaveLength(
          (WARMUP + SAMPLES) % 2 === 0 ? rows : rows - 1
        );
        for (const [name, result] of [
          ['patch: leaf field', leaf],
          ['patch: add / remove an assignment', link],
          ['patch: tombstone / restore (replaces the list)', tombstone],
        ] as const)
          lines.push(
            `| ${rows} | ${name} | ${us(result.time)} | ${result.bytes} B |`
          );
      }
      console.log(lines.join('\n'));
    }, 120_000);
  }
);
