import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  Message,
  MessageListItem,
  MessageParent,
} from '@service-storage/messages';
import { vi } from 'vitest';
import { createQueue } from '../../../email/tests/draft-sync-queue';
import { never } from '../../../email/tests/draft-sync-shared';
import type { MessageTimelineData } from '../../timeline';
import {
  CHANNEL,
  type ChannelServer,
  createChannelServer,
  ME,
  Refusal,
} from './channel-writes-server';

/**
 * The channel message client, run whole against a simulated server.
 *
 * Real: the four message hooks and their TanStack mutations, the channel
 * timeline query with its device-cache sync, the queued-write registry, the
 * normalized cache exchange with its mutation queue runner and retry policy,
 * and urql's fetch transport. Simulated: the server, the cache engine's
 * durable queue (`draft-sync-queue.ts`), the network and time.
 *
 * `reload()` replaces every module with a fresh instance over the same queue
 * and server, as a page reload does, and abandons the old page mid-flight.
 */

// The clock is fake; this lets everything already runnable finish.
const realSetImmediate = setImmediate;

/** Wait for work whose failure someone else reports. */
async function quietly(work: Promise<unknown>) {
  try {
    await work;
  } catch {
    // The caller reads the same promise, or its page is gone.
  }
}

export type WorldEvent =
  | { kind: 'toast'; message: string }
  | { kind: 'error'; message: string };

export type WorldSpan = { name: string; attributes: Record<string, unknown> };

/** A timeline row as the tests compare it. */
export type ShownRow = { id: string; content: string; reactions: string[] };

function shown(row: MessageListItem): ShownRow {
  return {
    id: row.id,
    content: row.content,
    reactions: row.reactions.map(
      (reaction) => `${reaction.emoji}:${reaction.users.join(',')}`
    ),
  };
}

/** How a write the test started ended, read without an unhandled rejection. */
export type Outcome =
  | { status: 'pending' }
  | { status: 'resolved'; value: Message | undefined }
  | { status: 'rejected'; error: unknown };

export type Write = {
  done: Promise<Message | undefined>;
  outcome: () => Outcome;
};

/** Every page shares the first page's copy of the generated documents. */
const STATELESS_MODULES = ['@service-storage/graphql/generated/graphql'];
const stateless = new Map<string, unknown>();

type WorldCore = {
  server: ChannelServer;
  /** The pages the device cache stores, by operation and variables. */
  disk: Map<string, unknown>;
  queue: ReturnType<typeof createQueue>;
  events: WorldEvent[];
  spans: WorldSpan[];
  /** Rows seen twice in the timeline at once, at any point. */
  duplicates: string[][];
  /** Each state of the open timeline its view rendered. */
  seen: ShownRow[][];
  /** How many times a page wrote a channel page to the device cache. */
  pageWrites: number;
  rest: { method: string; parent: MessageParent; messageId: string }[];
  /** Whether pages find the device cache, which sends channels over GraphQL. */
  cacheEnabled: boolean;
  /** How long the device cache takes to hold a write it is given. */
  cacheDelayMs: number;
  activity(): void;
};

function track(work: Promise<Message | undefined>): Write {
  let outcome: Outcome = { status: 'pending' };
  const watch = async () => {
    try {
      outcome = { status: 'resolved', value: await work };
    } catch (error) {
      outcome = { status: 'rejected', error };
    }
  };
  fireAndForget(watch(), 'channel-writes-world');
  return { done: work, outcome: () => outcome };
}

function restMessage(parent: MessageParent, id: string, content = id) {
  const at = new Date().toISOString();
  return {
    id,
    parent,
    thread_id: null,
    sender_id: ME,
    content,
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: at,
    updated_at: at,
  } satisfies Message;
}

type Page = Awaited<ReturnType<typeof boot>>;

/**
 * The queue's host, keeping the query results written to it as the engine
 * would, so a reloaded page opens a channel from the cache while offline.
 */
function withStoredPages(
  host: CacheHost,
  world: Pick<WorldCore, 'disk' | 'activity' | 'pageWrites' | 'cacheDelayMs'>,
  page: { alive: boolean }
): CacheHost {
  const key = (args: { operationName?: string; variables?: unknown }) =>
    `${args.operationName}:${JSON.stringify(args.variables ?? {})}`;
  return {
    ...host,
    async readQuery(args) {
      if (!page.alive) return await never();
      world.activity();
      await Promise.resolve();
      const data = world.disk.get(key(args));
      return data === undefined
        ? { kind: 'miss' }
        : { kind: 'hit', data: structuredClone(data) };
    },
    async enqueueOptimisticMutation(...args) {
      if (world.cacheDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, world.cacheDelayMs));
      }
      return await host.enqueueOptimisticMutation(...args);
    },
    async writeQuery(args) {
      const written = await host.writeQuery(args);
      world.disk.set(key(args), structuredClone(args.data));
      if (args.operationName === 'ChannelTimeline') world.pageWrites += 1;
      return written;
    },
  };
}

async function boot(world: WorldCore) {
  const page = { alive: true };
  vi.resetModules();
  const runtime: {
    queryClient?: unknown;
    host?: CacheHost;
    client?: unknown;
    readClient?: unknown;
  } = {};
  const record = (event: WorldEvent) => {
    if (page.alive) world.events.push(event);
  };
  const failure = (message: unknown) =>
    record({ kind: 'toast', message: String(message) });

  for (const id of STATELESS_MODULES) {
    const shared = stateless.get(id);
    if (shared) vi.doMock(id, () => shared);
  }
  vi.doMock('@core/component/Toast/Toast', () => ({
    toast: {
      failure,
      alert: failure,
      success: () => undefined,
      dismiss: () => undefined,
    },
  }));
  vi.doMock('@core/constant/featureFlags', () => ({
    enableGraphqlSoup: {},
    isFeatureEnabled: () => true,
  }));
  vi.doMock('@app/lib/analytics', () => ({
    analytics: { track: () => {}, posthog: { captureException: () => {} } },
  }));
  vi.doMock('@app/lib/analytics/analytics-context', () => ({
    useAnalytics: () => ({ track: () => {} }),
  }));
  vi.doMock('@queries/client', () => ({
    get queryClient() {
      return runtime.queryClient;
    },
    useQueryClient: () => runtime.queryClient,
  }));
  vi.doMock('@queries/soup/crm-association', () => ({
    messageReferencesCrmRecord: () => false,
    refreshCrmAssociatedSoupQueries: async () => {},
  }));
  vi.doMock('@queries/soup/normalized-cache', () => ({
    bumpSoupEntityTouchedAt: () => {},
    invalidateSoupEntity: () => {},
    optimisticUpdateSoupItemUpdatedAt: () => ({ rollback: () => {} }),
    refetchSoupEntity: async () => {},
  }));
  vi.doMock('@queries/messages/subscription', () => ({
    useMessageSubscription: () => {},
  }));
  const rest = (method: string) => (parent: MessageParent, id: unknown) => {
    world.activity();
    const messageId =
      typeof id === 'string' ? id : String((id as { id?: unknown }).id);
    world.rest.push({ method, parent, messageId });
    return Promise.resolve(restMessage(parent, messageId));
  };
  vi.doMock('@service-storage/messages', () => ({
    entityMessagesClient: {
      post: rest('post'),
      patch: rest('patch'),
      delete: rest('delete'),
      react: rest('react'),
      get: rest('get'),
    },
  }));
  vi.doMock('@service-storage/graphql-soup', () => ({
    getGraphqlSoupCacheHost: () =>
      world.cacheEnabled ? runtime.host : undefined,
    getGraphqlSoupClient: () => runtime.client,
    getUncachedGraphqlSoupClient: () => runtime.readClient,
  }));

  for (const id of STATELESS_MODULES)
    if (!stateless.has(id)) stateless.set(id, { ...(await import(id)) });
  const solid = await import('solid-js');
  const solidQuery = await import('@tanstack/solid-query');
  const urql = await import('@urql/core');
  const { Telemetry } = await import('@macro-inc/observability');
  vi.spyOn(Telemetry, 'error').mockImplementation(((error: unknown) =>
    record({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    })) as never);
  const realSpan = Telemetry.span.bind(Telemetry) as (
    name: string,
    operation: (span: unknown) => Promise<unknown>
  ) => Promise<unknown>;
  vi.spyOn(Telemetry, 'span').mockImplementation(((
    name: string,
    operation?: unknown
  ) => {
    if (typeof operation !== 'function')
      return (realSpan as (name: string, options?: unknown) => unknown)(
        name,
        operation
      );
    const attributes: Record<string, unknown> = {};
    if (page.alive) world.spans.push({ name, attributes });
    return realSpan(name, (span) =>
      operation(
        new Proxy(span as object, {
          get(target, key) {
            const value = Reflect.get(target, key);
            if (key === 'setAttr')
              return (attribute: string, attributeValue: unknown) => {
                attributes[attribute] = attributeValue;
                (value as (a: string, v: unknown) => void).call(
                  target,
                  attribute,
                  attributeValue
                );
              };
            return typeof value === 'function' ? value.bind(target) : value;
          },
        })
      )
    );
  }) as never);
  const { normalizedCacheExchange } = await import(
    '@graphql-cache/exchange/normalized-cache-exchange'
  );
  const { isGraphqlMutationBackPressure, shouldRetryGraphqlMutation } =
    await import('@service-storage/graphql-mutation-retry');

  // A page loads believing it is online until the browser says otherwise,
  // which it does not repeat for a page that loads offline.
  solidQuery.onlineManager.setOnline(true);
  const queryClient = new solidQuery.QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  runtime.queryClient = queryClient;
  queryClient.mount();
  const host = withStoredPages(world.queue.connect(page), world, page);
  runtime.host = host;

  const transport: typeof fetch = async (_input, init) => {
    if (!page.alive) return await never();
    world.activity();
    const body = JSON.parse(String(init?.body)) as {
      operationName: string;
      variables: Record<string, unknown>;
    };
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    try {
      const data = await world.server.handle(
        body.operationName,
        body.variables
      );
      if (!page.alive) return await never();
      return json({ data });
    } catch (error) {
      if (!page.alive) return await never();
      if (error instanceof Refusal)
        return json({
          data: null,
          errors: [
            { message: error.message, extensions: { code: error.code } },
          ],
        });
      throw error;
    }
  };
  runtime.client = urql.createClient({
    url: 'http://storage.test/graphql',
    preferGetMethod: false,
    fetch: transport,
    exchanges: [
      normalizedCacheExchange(host, {
        shouldRetryMutation: shouldRetryGraphqlMutation,
        isMutationBackPressure: isGraphqlMutationBackPressure,
      }),
      urql.fetchExchange,
    ],
  });
  runtime.readClient = urql.createClient({
    url: 'http://storage.test/graphql',
    preferGetMethod: false,
    fetch: transport,
    exchanges: [urql.fetchExchange],
  });

  const mutations = await import('@queries/messages/mutations');
  const reactions = await import('@queries/messages/reactions');
  const timeline = await import('@queries/messages/timeline');
  const { timelineMessages } = await import(
    '@queries/messages/timeline-entries'
  );
  const queuedWrites = await import('@queries/messages/graphql/queued-writes');
  const unsentPosts = await import('@queries/messages/graphql/unsent-posts');

  const disposers: (() => void)[] = [];
  const hooks = solid.createRoot((dispose) => {
    disposers.push(dispose);
    let made:
      | {
          send: ReturnType<typeof mutations.useSendMessageMutation>;
          edit: ReturnType<typeof mutations.usePatchMessageMutation>;
          remove: ReturnType<typeof mutations.useDeleteMessageMutation>;
          react: ReturnType<typeof reactions.useAddReactionMutation>;
          unreact: ReturnType<typeof reactions.useRemoveReactionMutation>;
        }
      | undefined;
    solid.createComponent(solidQuery.QueryClientProvider, {
      client: queryClient,
      get children() {
        made = {
          send: mutations.useSendMessageMutation(),
          edit: mutations.usePatchMessageMutation(),
          remove: mutations.useDeleteMessageMutation(),
          react: reactions.useAddReactionMutation(),
          unreact: reactions.useRemoveReactionMutation(),
        };
        return null;
      },
    });
    if (!made) throw new Error('The hooks did not mount');
    return made;
  });

  const timelineKey = timeline.getMessageTimelineQueryKey(CHANNEL, null);
  const timelineHash = solidQuery.hashKey(timelineKey);
  const shownRows = (): MessageListItem[] => {
    const data = queryClient.getQueryData<MessageTimelineData>(timelineKey);
    return (data?.pages ?? []).flatMap(timelineMessages);
  };
  disposers.push(
    queryClient.getQueryCache().subscribe((event) => {
      if (!page.alive || event.query.queryHash !== timelineHash) return;
      const ids = shownRows().map((row) => row.id);
      if (new Set(ids).size !== ids.length) world.duplicates.push(ids);
    })
  );

  let observer:
    | InstanceType<typeof solidQuery.InfiniteQueryObserver>
    | undefined;

  return {
    queryClient,
    host,
    queuedWrites,
    unsentPosts,
    /** Open the channel, as its view does, and keep it open. */
    open() {
      observer = new solidQuery.InfiniteQueryObserver(
        queryClient,
        timeline.messageTimelineQueryOptions(CHANNEL, null) as never
      );
      const opened = observer;
      // The view renders a microtask after the observer hears of a change,
      // from its latest result, as `useInfiniteQuery` does: changes made in
      // one task render once.
      disposers.push(
        opened.subscribe(() => {
          queueMicrotask(() => {
            if (!page.alive) return;
            const data = opened.getCurrentResult().data as
              | MessageTimelineData
              | undefined;
            world.seen.push(
              (data?.pages ?? []).flatMap(timelineMessages).map(shown)
            );
          });
        })
      );
    },
    /** Read the channel's latest page again, replacing what it shows. */
    refetch: () => queryClient.refetchQueries({ queryKey: timelineKey }),
    /** The timeline's rows, newest first. */
    rows: () => shownRows().map(shown),
    send(content: string, parent: MessageParent = CHANNEL) {
      const id = mutations.newMessageId();
      return {
        id,
        ...track(
          hooks.send.mutateAsync({
            parent,
            message: { content, mentions: [], attachments: [] },
            senderId: ME,
            optimisticId: id,
          })
        ),
      };
    },
    edit: (messageId: string, content: string, parent = CHANNEL) =>
      track(
        hooks.edit.mutateAsync({
          parent,
          messageID: messageId,
          content,
          mentions: [],
        })
      ),
    remove: (messageId: string, parent = CHANNEL) =>
      track(hooks.remove.mutateAsync({ parent, messageID: messageId })),
    react: (messageId: string, emoji: string, parent = CHANNEL) =>
      track(
        hooks.react.mutateAsync({
          parent,
          messageId,
          emoji,
          userId: ME,
          currentReactions: shownRows().find((row) => row.id === messageId)
            ?.reactions,
        })
      ),
    /** The page goes away mid-flight: nothing it started is heard from again. */
    kill() {
      page.alive = false;
      for (const dispose of disposers.splice(0)) dispose();
      host.dispose();
    },
  };
}

/** A fresh device, server and clock. Call `dispose()` when the test ends. */
export async function createChannelWritesWorld() {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'performance',
    ],
  });
  vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
  let activity = 0;
  const active = () => {
    activity += 1;
  };
  const core: WorldCore = {
    server: createChannelServer(),
    disk: new Map(),
    queue: createQueue(active),
    events: [],
    spans: [],
    duplicates: [],
    seen: [],
    pageWrites: 0,
    rest: [],
    cacheEnabled: true,
    cacheDelayMs: 0,
    activity: active,
  };

  /** Let everything already runnable finish, without moving the clock. */
  async function quiesce() {
    let quiet = 0;
    for (let round = 0; round < 400 && quiet < 6; round++) {
      const before = activity;
      await vi.advanceTimersByTimeAsync(0);
      for (let hop = 0; hop < 4; hop++)
        await new Promise<void>((resolve) => realSetImmediate(resolve));
      quiet = activity === before ? quiet + 1 : 0;
    }
  }
  async function advance(ms: number, step = 100) {
    await quiesce();
    for (let left = ms; left > 0; left -= step) {
      await vi.advanceTimersByTimeAsync(Math.min(step, left));
      await quiesce();
    }
  }
  /** Wait for one write, letting the clock run as far as it needs. */
  async function settle<T>(work: Promise<T>, limitMs = 120_000): Promise<T> {
    let done = false;
    const watch = async () => {
      await quietly(work);
      done = true;
    };
    fireAndForget(watch(), 'channel-writes-world');
    await quiesce();
    for (let waited = 0; !done && waited < limitMs; waited += 50) {
      await vi.advanceTimersByTimeAsync(50);
      await quiesce();
    }
    if (!done) throw new Error(`Still pending after ${limitMs} ms`);
    return await work;
  }

  let page: Page = await boot(core);
  return {
    server: core.server,
    queue: core.queue,
    events: core.events,
    spans: core.spans,
    duplicates: core.duplicates,
    seen: core.seen,
    rest: core.rest,
    get pageWrites() {
      return core.pageWrites;
    },
    advance,
    quiesce,
    settle,
    get page() {
      return page;
    },
    set cacheEnabled(value: boolean) {
      core.cacheEnabled = value;
    },
    set cacheDelayMs(value: number) {
      core.cacheDelayMs = value;
    },
    /** Lose or regain the network, as the browser reports it. */
    async setOffline(offline: boolean) {
      core.server.state.offline = offline;
      window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
      await quiesce();
    },
    /** The queue's writes, oldest first, as operation and message id. */
    queued: () =>
      core.queue.entries.map((entry) => {
        const input = (
          entry.args.variables as { input: Record<string, unknown> }
        ).input;
        return {
          operation: entry.args.operationName,
          messageId: String(input.id ?? input.messageId),
          content: input.content,
          superseded: entry.superseded,
        };
      }),
    /** Reload the tab: same queue and server, new page. */
    async reload() {
      page.kill();
      page = await boot(core);
      await quiesce();
      return page;
    },
    async dispose() {
      page.kill();
      await quiesce();
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.resetModules();
    },
  };
}

export type ChannelWritesWorld = Awaited<
  ReturnType<typeof createChannelWritesWorld>
>;
