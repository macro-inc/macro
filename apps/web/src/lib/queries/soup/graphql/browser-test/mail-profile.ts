import { stringifyDocument } from '@urql/core';
import { selectRecords } from '../../../../graphql-cache/exchange/record-selection';
import type { CacheHost } from '../../../../graphql-cache/host/types';
import { createWorkerCacheHost } from '../../../../graphql-cache/host/worker-host';
import type { EntityFilterCacheArgs } from '../../../../graphql-cache/protocol';
import {
  MailItemFieldsFragmentDoc,
  SoupDocument,
  type SoupQuery,
} from '../../../../service-clients/service-storage/graphql/generated/graphql';
import { readSoupPage } from '../read-soup-page';
import { response } from './fixtures';
import workerUrl from './mail-profile.engine-worker.ts?worker&url';

const NativeWorker = globalThis.Worker;
globalThis.Worker = new Proxy(NativeWorker, {
  construct(target, args: ConstructorParameters<typeof Worker>) {
    const [url, options] = args;
    return Reflect.construct(target, [
      options?.name?.startsWith('graphql-cache-engine:') ? workerUrl : url,
      options,
    ]);
  },
});
const measurements: Array<{
  kind: string;
  durationMs: number;
  limit?: number;
  through?: boolean;
}> = [];
const waiting = new Set<() => void>();
const scope = `mail-profile-${crypto.randomUUID()}`;
const channel = new BroadcastChannel(`soup-mail-profile:${scope}`);
channel.onmessage = (event) => {
  measurements.push(event.data);
  for (const notify of waiting) notify();
};
const host = createWorkerCacheHost({
  scope,
  requestTimeoutMs: 60_000,
});
const selection = selectRecords(MailItemFieldsFragmentDoc);
const template = response([1]).user.soup.items[0];
const roundtrips: Array<{ kind: string; durationMs: number }> = [];
const observed: CacheHost = {
  ...host,
  async readRecordsByKeys(args) {
    const started = performance.now();
    const result = await host.readRecordsByKeys(args);
    roundtrips.push({
      kind: 'read-records-by-keys',
      durationMs: performance.now() - started,
    });
    return result;
  },
  async currentRevision() {
    const started = performance.now();
    const result = await host.currentRevision();
    roundtrips.push({
      kind: 'current-revision',
      durationMs: performance.now() - started,
    });
    return result;
  },
};
const api = {
  async seed(fixture: {
    query: string;
    data: SoupQuery;
    filters: EntityFilterCacheArgs['filters'];
  }) {
    await host.hydrateQuery({
      query: fixture.query,
      data: fixture.data,
      identity: fixture.data.user.id,
    });
    const items = fixture.data.user.soup.items.map((item) => ({
      ...template,
      ...item,
    }));
    // Use the full production selection so projection reads have all their fields.
    for (let i = 0; i < items.length; i += 100) {
      await host.hydrateQuery({
        query: stringifyDocument(SoupDocument),
        operationName: 'Soup',
        variables: {
          input: {
            initial: {
              filters: fixture.filters,
              sortMethod: 'UPDATED_AT',
              emailView: 'ALL',
              limit: 100,
              expand: true,
            },
          },
        },
        data: {
          user: {
            ...fixture.data.user,
            soup: { items: items.slice(i, i + 100), nextCursor: null },
          },
        },
        identity: fixture.data.user.id,
      });
    }
  },
  async measure(filters: EntityFilterCacheArgs['filters'], size: number) {
    const args: EntityFilterCacheArgs = {
      filters,
      sortMethod: 'UPDATED_AT',
      sortDirection: 'DESC',
      limit: size,
      mail: { view: 'ALL' },
    };
    const first = await host.entityFilter(args);
    if (first.kind !== 'mail-page' || !first.endCursor)
      throw new Error('No first page');
    const samples = [];
    for (let i = 0; i < 11; i++) {
      const start = performance.now();
      const page = await host.entityFilter({
        ...args,
        mail: { view: 'ALL', through: first.endCursor },
      });
      const filtered = performance.now();
      const firstRead = roundtrips.length;
      if (page.kind !== 'mail-page') throw new Error('No window');
      const selected = await readSoupPage(observed, {
        page,
        select: selection,
        baseline: [],
        mailView: 'ALL',
      });
      const finished = performance.now();
      samples.push({
        filterMs: filtered - start,
        readAndProjectMs: finished - filtered,
        jsProjectionMs:
          finished -
          filtered -
          roundtrips
            .slice(firstRead)
            .reduce((total, read) => total + read.durationMs, 0),
        totalMs: finished - start,
        rows: selected.kind === 'ready' ? selected.records.length : 0,
      });
    }
    await new Promise<void>((resolve) => {
      const ready = () => {
        if (
          measurements.filter(
            (sample) => sample.through && sample.limit === size
          ).length < 11
        )
          return;
        waiting.delete(ready);
        resolve();
      };
      waiting.add(ready);
      ready();
    });
    return {
      size,
      samples: samples.slice(1),
      worker: measurements.splice(0),
      roundtrips: roundtrips.splice(0),
    };
  },
};
export type MailProfileApi = typeof api;

declare global {
  interface Window {
    mailProfile: typeof api;
  }
}
window.mailProfile = api;
window.addEventListener(
  'pagehide',
  () => {
    host.dispose();
    channel.close();
  },
  { once: true }
);
