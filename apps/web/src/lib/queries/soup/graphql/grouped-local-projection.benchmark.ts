import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { INITIAL_CACHE_REVISION } from '../../../graphql-cache/protocol';
import type {
  GroupedSoupInitialInput,
  GroupSoupQuery,
  SoupItemFieldsFragment,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import {
  createLocalGroupedSoupProjection,
  localSoupGroupKeys,
  mergeGroupedSoupBins,
  projectLocalGroupedSoup,
} from './grouped-local-projection';
import { groupedDocument } from './grouped-test-fixtures';
import { materializeReconciledSoup, soupItemKey } from './reconciliation';

const now = new Date('2026-10-10T12:00:00Z');
const warmup = 20;
const samples = 100;

function measure(run: () => number) {
  let checksum = 0;
  for (let index = 0; index < warmup; index++) checksum += run();
  const durations: number[] = [];
  for (let index = 0; index < samples; index++) {
    const started = performance.now();
    checksum += run();
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  return {
    medianMs: durations[Math.floor(samples / 2)],
    p95Ms: durations[Math.floor(samples * 0.95)],
    maxMs: durations.at(-1),
    checksum,
  };
}

function scenario(
  size: number,
  field: GroupedSoupInitialInput['groupBy']['field'],
  multi: boolean
) {
  const input: GroupedSoupInitialInput = {
    groupBy: { field, propertyDefinitionId: 'status-definition' },
    sortMethod: 'UPDATED_AT',
    limit: 100,
  };
  const before = Array.from({ length: size }, (_, index) => ({
    ...groupedDocument(
      String(index),
      Array.from(
        { length: multi ? 3 : 1 },
        (_, offset) => `bin-${(index + offset) % 5}`
      )
    ),
    projectId: `project-${index % 20}`,
    updatedAt: new Date(
      now.getTime() - (index % 90) * 86_400_000
    ).toISOString(),
  }));
  const initialBins = new Map<string, typeof before>();
  for (const item of before) {
    for (const key of localSoupGroupKeys(item, input, now) ?? []) {
      const items = initialBins.get(key) ?? [];
      items.push(item);
      initialBins.set(key, items);
    }
  }
  const pages: GroupSoupQuery[] = [];
  const initial: GroupSoupQuery = {
    user: { id: 'benchmark', groupSoup: { bins: [] } },
  };
  pages.push(initial);
  for (const [key, items] of initialBins) {
    for (let offset = 0; offset < items.length; offset += 10) {
      const bin = {
        key,
        items: items.slice(offset, offset + 10),
        totalCount: items.length + 100,
        nextCursor: `${key}:${offset + 10}`,
      };
      if (offset === 0) initial.user.groupSoup.bins.push(bin);
      else
        pages.push({ user: { id: 'benchmark', groupSoup: { bins: [bin] } } });
    }
  }
  const baseline = mergeGroupedSoupBins(pages);
  // Deterministic moves and proven filter exclusions, including multi-value bins.
  const after = before
    .filter((_, index) => index % 23 !== 0)
    .map((item, index) =>
      index % 20 === 0
        ? {
            ...item,
            projectId: 'project-new',
            updatedAt: now.toISOString(),
            properties: groupedDocument(item.id, ['destination']).properties,
          }
        : item
    );
  const records = after.map((record) => ({
    recordKey: soupItemKey(record),
    record,
  }));
  const [selected, setSelected] = createStore({ records });
  const snapshot = {
    revision: INITIAL_CACHE_REVISION,
    optimistic: true,
    retainedKeys: [],
    keys: records.map((row) => row.recordKey),
    records: selected.records,
  };
  return { input, before, baseline, pages, snapshot, setSelected };
}

/** Incremental main-thread cost only: excludes worker filtering, IPC, network and DOM layout. */
export function runGroupedSoupBenchmark() {
  const results = [];
  for (const size of [100, 1_000, 5_000]) {
    for (const [field, multi] of [
      ['PROPERTY', false],
      ['PROPERTY', true],
      ['PROJECT', false],
      ['DATE', false],
    ] as const) {
      console.info(`Starting ${size} rows, ${field}, multi=${multi}`);
      const data = scenario(size, field, multi);
      const result = createRoot((dispose) => {
        try {
          const groupedProjection = createRoot((disposeFullProjection) => {
            try {
              const [tick, setTick] = createSignal(0);
              // Measure tracked reads of actual Solid store proxies, not just plain JSON.
              const grouped = createMemo(() => {
                tick();
                const currentItems = new Map<string, SoupItemFieldsFragment>();
                for (const page of data.pages)
                  for (const bin of page.user.groupSoup.bins)
                    for (const item of bin.items)
                      currentItems.set(soupItemKey(item), item);
                return projectLocalGroupedSoup(
                  data.baseline,
                  currentItems,
                  data.snapshot,
                  data.input,
                  now
                );
              });
              return measure(() => {
                setTick((value) => value + 1);
                return grouped().reduce(
                  (count, bin) => count + bin.items.length,
                  0
                );
              });
            } finally {
              disposeFullProjection();
            }
          });
          const evidence = {
            bins: data.baseline,
            untrustedKeys: new Set<string>(),
          };
          const currentItems = new Map(
            data.before.map((item) => [soupItemKey(item), item])
          );
          const incremental = createLocalGroupedSoupProjection({
            baseline: () => evidence,
            currentItems: () => currentItems,
            snapshot: () => data.snapshot,
            input: () => data.input,
            now: () => now,
          });
          let edit = 0;
          const incrementalDisplay = measure(() => {
            data.setSelected(
              'records',
              0,
              'record',
              'displayName',
              `Edit ${edit++}`
            );
            return incremental()?.length ?? 0;
          });
          const incrementalGrouping = measure(() => {
            const changed = edit++ % 2 === 0;
            if (field === 'DATE') {
              data.setSelected(
                'records',
                0,
                'record',
                'updatedAt',
                changed ? now.toISOString() : '2026-09-01T00:00:00Z'
              );
            } else {
              const properties = groupedDocument(
                'changed',
                changed ? ['destination'] : ['bin-0']
              ).properties;
              if (field === 'PROJECT') {
                properties[0] = {
                  ...properties[0],
                  propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
                  value: {
                    __typename: 'GraphqlEntityReferencePropertyValue',
                    references: [
                      {
                        entityId: changed ? 'project-new' : 'project-0',
                        entityType: 'INITIATIVE',
                        specificMessageId: null,
                      },
                    ],
                  },
                };
              }
              data.setSelected(
                'records',
                0,
                'record',
                'properties',
                properties
              );
            }
            return incremental()?.length ?? 0;
          });
          return { groupedProjection, incrementalDisplay, incrementalGrouping };
        } finally {
          dispose();
        }
      });
      const flatProjection = createRoot((dispose) => {
        try {
          const [tick, setTick] = createSignal(0);
          const flat = createMemo(() => {
            tick();
            return materializeReconciledSoup(
              data.snapshot.keys,
              data.snapshot.records,
              data.before
            );
          });
          return measure(() => {
            setTick((value) => value + 1);
            return flat().length;
          });
        } finally {
          dispose();
        }
      });
      const pageMerge = measure(() => mergeGroupedSoupBins(data.pages).length);
      results.push({
        size,
        field,
        multi,
        bins: data.baseline.length,
        memberships: data.baseline.reduce(
          (count, bin) => count + bin.items.length,
          0
        ),
        pages: data.pages.length,
        ...result,
        flatProjection,
        pageMerge,
      });
    }
  }
  return { warmup, samples, results };
}

declare global {
  interface Window {
    runGroupedSoupBenchmark: typeof runGroupedSoupBenchmark;
  }
}
window.runGroupedSoupBenchmark = runGroupedSoupBenchmark;
