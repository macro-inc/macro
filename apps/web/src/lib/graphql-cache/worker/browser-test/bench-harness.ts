/**
 * Cache engine benchmark page. Drives the production `createWorkerCacheHost`
 * (SharedWorker coordinator + dedicated OPFS engine) with a synthetic,
 * production-sized dataset and reports wall-clock timings for setup, seeding,
 * reads and writes. The runner (`bench-runner.ts`) serves the dataset under
 * `/bench-data/` and orchestrates pages; this page only measures.
 */
import { stringifyDocument } from '@urql/core';
import * as generated from '../../../service-clients/service-storage/graphql/generated/graphql';
import type { CacheHost } from '../../host/types';
import { createWorkerCacheHost } from '../../host/worker-host';
import { captureContactWriteScope } from '../../people/sync';
import type { EntityFilterCacheArgs } from '../../protocol';
import type {
  CacheTelemetryObservation,
  CacheTelemetryRecorderLike,
} from '../../telemetry';
import mailTabs from './bench-mail-tabs.json';

const resultElement = document.querySelector<HTMLElement>('#result');
if (!resultElement) throw new Error('missing result element');

type BenchOp = {
  lane: string;
  op: 'hydrate' | 'write';
  doc: string;
  operationName: string;
  variables: Record<string, unknown>;
  data: unknown;
};

type Observation = CacheTelemetryObservation & { at: number; side: string };

const documents = generated as unknown as Record<string, unknown>;
const textCache = new Map<string, string>();
function documentText(name: string, suffix = 'Document'): string {
  const key = `${name}${suffix}`;
  let text = textCache.get(key);
  if (text === undefined) {
    const document = documents[key];
    if (!document) throw new Error(`unknown document ${key}`);
    text = stringifyDocument(
      document as Parameters<typeof stringifyDocument>[0]
    );
    textCache.set(key, text);
  }
  return text;
}

const observations: Observation[] = [];
const pageRecorder: CacheTelemetryRecorderLike = {
  record(observation) {
    observations.push({ ...observation, at: performance.now(), side: 'page' });
  },
  flush() {},
};
const workerChannel = new BroadcastChannel('macro:graphql-cache-telemetry:v1');
workerChannel.onmessage = (event: MessageEvent<CacheTelemetryObservation>) => {
  observations.push({ ...event.data, at: performance.now(), side: 'worker' });
};

let host: CacheHost | undefined;
let opKey = 1;
const nil = '00000000-0000-0000-0000-000000000000';

function requireHost(): CacheHost {
  if (!host) throw new Error('cache host is not open');
  return host;
}

async function fetchOp(path: string): Promise<BenchOp> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as BenchOp;
}

async function timed<T>(run: () => Promise<T>): Promise<[number, T]> {
  const started = performance.now();
  const value = await run();
  return [performance.now() - started, value];
}

/** Opens the host and waits for the first read: the cold-start cost a tab pays. */
async function open(scope: string) {
  const started = performance.now();
  observations.length = 0;
  host = createWorkerCacheHost({
    scope,
    requestTimeoutMs: 120_000,
    initializationTimeoutMs: 120_000,
    telemetry: pageRecorder,
  });
  const [firstReadMs] = await timed(() =>
    requireHost().entityFilter(inboxArgs(50))
  );
  return {
    totalMs: performance.now() - started,
    firstReadMs,
    lifecycle: observations
      .filter((o) => !HIGH_VOLUME.has(o.name))
      .map(({ name, side, durationMs, outcome, at }) => ({
        name,
        side,
        durationMs,
        outcome,
        at: at - started,
      })),
  };
}

const HIGH_VOLUME = new Set([
  'graphql_cache.host_request',
  'graphql_cache.coordinator_request',
  'graphql_cache.engine_request',
  'graphql_cache.transaction',
  'graphql_cache.read',
]);

async function apply(op: BenchOp): Promise<number> {
  const target = requireHost();
  const query = documentText(op.doc);
  const authority = target.authority;
  if (!authority) throw new Error('cache host has no authority');
  const { generation } = await authority.current();
  // The app passes the viewer id on every Soup response (extractIdentity).
  const identity = (op.data as { user?: { id?: string } } | undefined)?.user
    ?.id;
  // Contact pages carry the fenced scope the app captures before fetching
  // (captureContactWriteScope); the capture is part of the measured write.
  const hydrationScope = async () => {
    if (op.operationName !== 'ContactDirectoryBackfill' || !identity) return;
    const scope = {
      identity,
      storageGeneration: await target.currentStorageGeneration(),
    };
    const guarded = await captureContactWriteScope(
      target,
      scope,
      new AbortController().signal
    );
    if (!guarded) throw new Error('cache host has no contact fence');
    return guarded;
  };
  const [ms] = await timed(async () =>
    op.op === 'hydrate'
      ? target.hydrateQuery({
          generation,
          query,
          operationName: op.operationName,
          variables: op.variables,
          data: op.data,
          identity,
          hydrationScope: await hydrationScope(),
        })
      : target.writeQuery({
          opKey: opKey++,
          generation,
          query,
          operationName: op.operationName,
          variables: op.variables,
          data: op.data,
          identity,
        })
  );
  return ms;
}

/** Applies dataset ops in order; reports each op's latency and payload size. */
async function seed(base: string, count: number) {
  const rows: Array<{ lane: string; ms: number; bytes: number }> = [];
  for (let index = 0; index < count; index++) {
    const response = await fetch(`${base}/${index}`);
    const text = await response.text();
    const op = JSON.parse(text) as BenchOp;
    rows.push({ lane: op.lane, ms: await apply(op), bytes: text.length });
  }
  return rows;
}

function mailOnly(): Record<string, unknown> {
  return {
    documentFilter: { literal: { id: nil } },
    projectFilter: { literal: { projectIdSelf: nil } },
    chatFilter: { literal: { chatId: nil } },
    calendarEventFilter: { literal: { id: nil } },
    channelFilter: { literal: { channelId: nil } },
    channelThreadFilter: { literal: { threadId: nil } },
    callFilter: { literal: { callId: nil } },
    crmCompanyFilter: { literal: { id: nil } },
    foreignEntityFilter: { literal: { id: nil } },
  };
}

function inboxArgs(
  limit: number,
  view: 'INBOX' | 'ALL' = 'INBOX',
  cursor?: string
): EntityFilterCacheArgs {
  return {
    filters: mailOnly(),
    sortMethod: 'UPDATED_AT',
    sortDirection: 'DESC',
    limit,
    mail: { view, ...(cursor ? { cursor } : {}) },
  };
}

/** A Mail tab's list read as the app sends it (the fixture's own test keeps it so). */
function tabArgs(
  input: (typeof mailTabs)[keyof typeof mailTabs]
): EntityFilterCacheArgs {
  return {
    filters: input.filters,
    sortMethod: input.sortMethod,
    sortDirection: input.sortDirection,
    limit: input.limit,
    mail: { view: input.emailView },
  } as EntityFilterCacheArgs;
}

function coreArgs(limit: number): EntityFilterCacheArgs {
  return {
    // Documents, projects, chats and channels: the kinds the cache projects.
    filters: {
      emailFilter: { tree: { literal: { threadId: nil } } },
      calendarEventFilter: { literal: { id: nil } },
      channelThreadFilter: { literal: { threadId: nil } },
      callFilter: { literal: { callId: nil } },
      crmCompanyFilter: { literal: { id: nil } },
      foreignEntityFilter: { literal: { id: nil } },
    },
    sortMethod: 'UPDATED_AT',
    sortDirection: 'DESC',
    limit,
    // No baseline: exact evaluation, the request the native bench measures.
  };
}

type Step = { name: string; ms: number; detail?: unknown };

/** One pass over the user-visible reads the app makes from the cache. */
async function readPass(threads: string[], homeVariables: unknown) {
  const target = requireHost();
  const steps: Step[] = [];
  const step = async <T>(name: string, run: () => Promise<T>) => {
    const [ms, value] = await timed(run);
    steps.push({ name, ms });
    return value;
  };

  for (const [tab, input] of Object.entries(mailTabs)) {
    const page = await step(`mail.tab.${tab}.filter`, () =>
      target.entityFilter(tabArgs(input))
    );
    if (page.kind !== 'mail-page') throw new Error(JSON.stringify(page));
  }
  const inbox = await step('mail.inbox.filter', () =>
    target.entityFilter(inboxArgs(50))
  );
  if (inbox.kind !== 'mail-page') throw new Error(JSON.stringify(inbox));
  await step('mail.inbox.rows', () =>
    target.readRecordsByKeys({
      document: documentText('MailItemFields', 'FragmentDoc'),
      fragmentName: 'MailItemFields',
      keys: inbox.keys,
    })
  );
  if (inbox.nextCursor) {
    const next = await step('mail.inbox.page2.filter', () =>
      target.entityFilter(inboxArgs(50, 'INBOX', inbox.nextCursor ?? undefined))
    );
    if (next.kind === 'mail-page')
      await step('mail.inbox.page2.rows', () =>
        target.readRecordsByKeys({
          document: documentText('MailItemFields', 'FragmentDoc'),
          fragmentName: 'MailItemFields',
          keys: next.keys,
        })
      );
  }
  const all = await step('mail.all.filter', () =>
    target.entityFilter(inboxArgs(50, 'ALL'))
  );
  if (all.kind === 'mail-page')
    await step('mail.all.rows', () =>
      target.readRecordsByKeys({
        document: documentText('MailItemFields', 'FragmentDoc'),
        fragmentName: 'MailItemFields',
        keys: all.keys,
      })
    );
  const core = await step('soup.core.filter', () =>
    target.entityFilter(coreArgs(50))
  );
  if (core.kind === 'reconciled' || core.kind === 'complete')
    await step('soup.core.rows', () =>
      target.readRecordsByKeys({
        document: documentText('SoupItemFields', 'FragmentDoc'),
        fragmentName: 'SoupItemFields',
        keys: core.keys,
      })
    );
  await step('soup.home.readQuery', () =>
    target.readQuery({
      query: documentText('Soup'),
      operationName: 'Soup',
      variables: homeVariables as Record<string, unknown>,
    })
  );
  for (const threadId of threads) {
    await step('thread.readQuery', () =>
      target.readQuery({
        query: documentText('EmailThreadPage'),
        operationName: 'EmailThreadPage',
        variables: { threadId, offset: 0, limit: 20 },
      })
    );
  }
  await step('search.empty', () =>
    target.search({ profile: 'quick-access-v1', limit: 20 })
  );
  for (const query of ['pro', 'project update', 'zzqx']) {
    await step(`search.typed`, () =>
      target.search({ profile: 'quick-access-v1', query, limit: 20 })
    );
  }
  return {
    steps,
    counts: {
      inbox: inbox.keys.length,
      all: all.kind === 'mail-page' ? all.keys.length : -1,
      core:
        core.kind === 'reconciled' || core.kind === 'complete'
          ? core.keys.length
          : core.kind,
    },
  };
}

/** Writes the ops at `indices`, then the same responses again: the second
 * pass is what a refetch that changed nothing costs. */
async function writePass(base: string, indices: number[]) {
  const steps: Step[] = [];
  const ops: BenchOp[] = [];
  for (const index of indices) ops.push(await fetchOp(`${base}/${index}`));
  for (const op of ops)
    steps.push({ name: `write.${op.lane}`, ms: await apply(op) });
  for (const op of ops)
    steps.push({ name: `write.${op.lane}.same`, ms: await apply(op) });
  return { steps };
}

/** Reads while background hydration of `base` ops keeps the engine busy. */
async function contended(
  threads: string[],
  homeVariables: unknown,
  base: string,
  count: number
) {
  const ops: BenchOp[] = [];
  for (let index = 0; index < count; index++)
    ops.push(await fetchOp(`${base}/${index}`));
  let stop = false;
  const background: number[] = [];
  const loop = (async () => {
    for (let index = 0; !stop; index = (index + 1) % ops.length) {
      const op = ops[index];
      if (!op) break;
      background.push(await apply({ ...op, op: 'hydrate' }));
    }
  })();
  const reads = await readPass(threads, homeVariables);
  stop = true;
  await loop;
  return { ...reads, background };
}

async function storage() {
  const estimate = await navigator.storage.estimate();
  const root = await navigator.storage.getDirectory();
  const files: Array<{ name: string; bytes: number }> = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, handle] of (
      dir as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>;
      }
    ).entries()) {
      if (handle.kind === 'directory')
        await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
      else {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          files.push({ name: `${prefix}${name}`, bytes: file.size });
        } catch {
          files.push({ name: `${prefix}${name}`, bytes: -1 });
        }
      }
    }
  };
  await walk(root, '');
  return { usage: estimate.usage, quota: estimate.quota, files };
}

function telemetry() {
  return observations.map(
    ({
      name,
      side,
      durationMs,
      outcome,
      count,
      at,
      queryFingerprint,
      operationCategory,
      aggregatedEventName,
    }) => ({
      name,
      aggregatedEventName,
      side,
      operationCategory,
      durationMs,
      count,
      outcome,
      queryFingerprint,
      at,
    })
  );
}

function close() {
  host?.dispose();
  host = undefined;
}

Object.assign(window, {
  cacheBench: {
    open,
    seed,
    readPass,
    writePass,
    contended,
    storage,
    telemetry,
    clearTelemetry: () => {
      observations.length = 0;
    },
    close,
    host: () => host,
    documentText,
    inboxArgs,
    coreArgs,
  },
});
resultElement.dataset.status = 'ready';
resultElement.textContent = 'ready';
