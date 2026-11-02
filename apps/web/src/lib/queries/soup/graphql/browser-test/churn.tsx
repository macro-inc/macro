import { TraceFlow } from '@app/observability/flow';
import { initializeUiOperationTelemetry } from '@app/observability/ui-operation';
import { Telemetry } from '@macro-inc/observability';
import { gql } from '@urql/core';
import { createComputed, For } from 'solid-js';
import { render } from 'solid-js/web';
import { selectRecords } from '../../../../graphql-cache/exchange/record-selection';
import { createNoopCacheHost } from '../../../../graphql-cache/host/noop-host';
import type {
  CacheChangeListener,
  CacheHost,
} from '../../../../graphql-cache/host/types';
import { parseCacheRevision } from '../../../../graphql-cache/protocol';
import { createPredicateQuery } from '../create-predicate-query';

const listeners = new Set<CacheChangeListener>();
let revision = 1;
let reads = 0;
let projections = 0;
let mounts = 0;
let perfSpans = 0;
const startPerfSpan = Telemetry.perfSpan.bind(Telemetry);
Telemetry.perfSpan = (name, startTime) => {
  perfSpans++;
  return startPerfSpan(name, startTime);
};
const host: CacheHost = {
  ...createNoopCacheHost(),
  onCacheChanged(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async entityFilter(args) {
    if (args.liveQuery?.release) return { kind: 'unsupported' };
    reads++;
    const reset = args.liveQuery?.since === undefined;
    return {
      kind: 'live-query',
      revision: parseCacheRevision(String(revision)),
      reset,
      ...(reset
        ? { keys: Array.from({ length: 1000 }, (_, i) => String(i)) }
        : {}),
      upserts: reset
        ? Array.from({ length: 1000 }, (_, i) => ({
            recordKey: String(i),
            record: { id: String(i), name: `Row ${i}` },
          }))
        : [],
      patches: [],
      removed: [],
      retainedKeys: [],
      optimistic: false,
    };
  },
};
function App() {
  const query = createPredicateQuery<{ id: string; name: string }>({
    host: () => host,
    query: () => ({
      source: {
        filters: {},
        sortMethod: 'UPDATED_AT',
        sortDirection: 'DESC',
        limit: 1000,
        baseline: [],
      },
      select: selectRecords(
        gql`fragment Churn on GraphqlSoupDocument { id name: displayName }`
      ),
    }),
  });
  createComputed(() => {
    query.data()?.records;
    projections++;
  });
  return (
    <ul>
      <For each={query.data()?.records}>
        {(row) => {
          mounts++;
          return <li>{row.record.name}</li>;
        }}
      </For>
    </ul>
  );
}
const trace = new URLSearchParams(location.search).has('trace');
if (trace) {
  const { createWebTracingProvider } = await import(
    '@macro-inc/observability/web'
  );
  const config = {
    serviceName: 'web-app',
    environment: 'dev',
    perfSampleRate: 1,
    tracesUrl: `${location.origin}/__churn_traces`,
    enabled: async () => true,
  };
  initializeUiOperationTelemetry();
  await Telemetry.init({
    ...config,
    tracingProvider: (resource, getUserId, perfSampled) =>
      createWebTracingProvider(config, resource, getUserId, perfSampled),
  });
}
const dispose = render(
  () =>
    trace ? (
      <TraceFlow name="soup.churn">
        <App />
      </TraceFlow>
    ) : (
      <App />
    ),
  document.querySelector('#app')!
);
const api = {
  stats: () => ({ revision, reads, projections, mounts, perfSpans }),
  flush: () => Telemetry.flush(),
  emit() {
    revision++;
    for (const listener of listeners)
      listener(parseCacheRevision(String(revision)));
  },
};
declare global {
  interface Window {
    soupChurn: typeof api;
  }
}
window.soupChurn = api;
window.addEventListener('pagehide', dispose, { once: true });
