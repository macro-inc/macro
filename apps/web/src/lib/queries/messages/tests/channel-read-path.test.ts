import type { CacheRevision } from '@graphql-cache/index';
import {
  type DocumentNode,
  type FragmentDefinitionNode,
  Kind,
  parse,
  type SelectionNode,
} from 'graphql';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_ID,
  type FakeHost,
  fakeHost,
  graphqlMessage,
} from '../local/tests/fixtures';

type FlagAnswer = { enabled: boolean; loading: boolean };

const mocks = vi.hoisted(() => ({
  host: {} as unknown,
  fetchResolved: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', async () => {
  const solid = await import('solid-js');
  const [read, write] = solid.createSignal<FlagAnswer>({
    enabled: false,
    loading: true,
  });
  return { useFeatureFlag: () => read, __setFlag: write };
});
// Not over the original: it imports the modules under test, which would then
// read it instead of this.
vi.mock('@service-storage/graphql-soup', async () => {
  const solid = await import('solid-js');
  const [kept, setKept] = solid.createSignal<unknown>();
  return {
    // A host the session keeps is not handed out while it does not serve.
    getGraphqlSoupCacheHost: () => (kept() ? undefined : mocks.host),
    getKeptGraphqlCacheHost: kept,
    graphqlCacheEnabled: () => kept() === undefined,
    dssGraphqlFetch: vi.fn(),
    graphqlSoupTransportDocument: (document: unknown) => document,
    __setKept: setKept,
  };
});
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => true,
}));

vi.mock('../timeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../timeline')>()),
  fetchResolvedChannelMessage: mocks.fetchResolved,
}));

const { useChannelReadPath, useChannelMessageResolver } = await import(
  '../channel-timeline-source'
);
const { channelCacheHost, markChannelCacheAnswered } = await import(
  '../local/channel-flag'
);
const soup = (await import('@service-storage/graphql-soup')) as unknown as {
  __setKept: (host: unknown) => void;
};
const posthog = (await import('@app/lib/analytics/posthog')) as unknown as {
  __setFlag: (next: FlagAnswer) => void;
};

/** The top-level fields a fragment selects on `typename`, through its spreads. */
function selectedFields(
  document: DocumentNode,
  selections: readonly SelectionNode[],
  typename: unknown
): string[] {
  return selections.flatMap((selection) => {
    if (selection.kind === Kind.FIELD) return [selection.name.value];
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      const on = selection.typeCondition?.name.value;
      if (on !== undefined && on !== typename) return [];
      return selectedFields(
        document,
        selection.selectionSet.selections,
        typename
      );
    }
    const fragment = document.definitions.find(
      (definition): definition is FragmentDefinitionNode =>
        definition.kind === Kind.FRAGMENT_DEFINITION &&
        definition.name.value === selection.name.value
    );
    if (!fragment || fragment.typeCondition.name.value !== typename) return [];
    return selectedFields(document, fragment.selectionSet.selections, typename);
  });
}

/**
 * A host that, as the cache does, reads a record only when it holds every
 * field the read selects; `partial` holds fewer.
 */
function completeRecordsOnly(
  host: FakeHost,
  partial: ReadonlyArray<Record<string, unknown> & { id: string }>
): FakeHost {
  const records = new Map<string, unknown>([
    ...host.records,
    ...partial.map(
      (record) => [`GraphqlChannelMessage:${record.id}`, record] as const
    ),
  ]);
  return {
    ...host,
    async readRecordsByKeys({ document, fragmentName, keys }) {
      const parsed = parse(document);
      const root = parsed.definitions.find(
        (definition): definition is FragmentDefinitionNode =>
          definition.kind === Kind.FRAGMENT_DEFINITION &&
          definition.name.value === fragmentName
      );
      return {
        revision: '1' as CacheRevision,
        records: keys.flatMap((recordKey) => {
          const record = records.get(recordKey) as
            | Record<string, unknown>
            | undefined;
          if (!record || !root) return [];
          const fields = selectedFields(
            parsed,
            root.selectionSet.selections,
            record.__typename
          );
          if (!fields.every((field) => field in record)) return [];
          return [{ recordKey, record }];
        }),
      };
    },
  };
}

describe('useChannelReadPath', () => {
  it('reads over REST at once while the flag has no answer, and stays there', () => {
    posthog.__setFlag({ enabled: false, loading: true });
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });

    const path = createRoot(() => useChannelReadPath(parent));
    expect(path.mode()).toBe('rest');

    posthog.__setFlag({ enabled: true, loading: false });
    expect(path.mode()).toBe('rest');
  });

  it('reads from the device when the flag is on at mount, and stays there', () => {
    posthog.__setFlag({ enabled: true, loading: false });
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });

    const path = createRoot(() => useChannelReadPath(parent));
    expect(path.mode()).toBe('local');

    posthog.__setFlag({ enabled: false, loading: false });
    expect(path.mode()).toBe('local');

    path.setUnsupported();
    expect(path.mode()).toBe('rest');
  });
});

describe('a host whose database is away', () => {
  const outage = { paused: true, disabled: true };
  afterEach(() => {
    soup.__setKept(undefined);
    mocks.host = {};
  });

  it('keeps an open channel on the device, and reads and writes ask for it still', () => {
    posthog.__setFlag({ enabled: true, loading: false });
    const host = { paused: false, disabled: false };
    mocks.host = host;
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });
    const path = createRoot(() => useChannelReadPath(parent));
    expect(path.mode()).toBe('local');

    Object.assign(host, outage);
    soup.__setKept(host);
    expect(path.mode()).toBe('local');
    expect(path.host()).toBe(host);
    // A write goes to the host and its queue, never past them.
    expect(channelCacheHost()).toBe(host);

    Object.assign(host, { paused: false, disabled: false });
    soup.__setKept(undefined);
    expect(path.mode()).toBe('local');
    expect(path.host()).toBe(host);
  });

  it('opens a channel on the device meanwhile', () => {
    posthog.__setFlag({ enabled: true, loading: false });
    soup.__setKept({ ...outage });
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });
    expect(createRoot(() => useChannelReadPath(parent)).mode()).toBe('local');
  });

  it('stays with a host that answered before while the session proves it again', () => {
    const host = { paused: false, disabled: false };
    soup.__setKept(host);
    // A replacement that has answered nothing yet is not waited on.
    expect(channelCacheHost()).toBeUndefined();
    markChannelCacheAnswered(host as never);
    expect(channelCacheHost()).toBe(host);
  });

  it('stays with a host whose database was away while the session proves it again', () => {
    const host = { ...outage };
    soup.__setKept(host);
    expect(channelCacheHost()).toBe(host);
    // It took writes while it was away, though it has answered nothing yet.
    Object.assign(host, { paused: false, disabled: false });
    expect(channelCacheHost()).toBe(host);
  });

  it('moves an open channel to REST once the host is gone', () => {
    posthog.__setFlag({ enabled: true, loading: false });
    const host = { ...outage };
    soup.__setKept(host);
    const [parent] = createSignal({ type: 'channel' as const, id: 'c1' });
    const path = createRoot(() => useChannelReadPath(parent));
    expect(path.mode()).toBe('local');

    mocks.host = undefined;
    soup.__setKept(undefined);
    expect(path.mode()).toBe('rest');
    expect(channelCacheHost()).toBeUndefined();
  });
});

describe('useChannelMessageResolver', () => {
  it('places a linked reply from the device, without the server', async () => {
    posthog.__setFlag({ enabled: true, loading: false });
    const root = graphqlMessage(1);
    const reply = graphqlMessage(2, { threadId: root.id });
    mocks.host = fakeHost([], { records: [root, reply] });
    const [parent] = createSignal({ type: 'channel' as const, id: CHANNEL_ID });

    // With no connection the server is not there to ask.
    const resolve = createRoot(() => useChannelMessageResolver(parent));
    expect(await resolve(reply.id)).toEqual({
      kind: 'thread_reply',
      threadId: root.id,
    });
    expect(await resolve(root.id)).toEqual({ kind: 'top_level' });
    expect(mocks.fetchResolved).not.toHaveBeenCalled();
    mocks.host = {};
  });

  it('asks the server for a message the device does not hold', async () => {
    posthog.__setFlag({ enabled: true, loading: false });
    mocks.host = fakeHost([]);
    mocks.fetchResolved.mockResolvedValueOnce({
      kind: 'thread_reply',
      thread_id: 'root-9',
    });
    const [parent] = createSignal({ type: 'channel' as const, id: CHANNEL_ID });

    const resolve = createRoot(() => useChannelMessageResolver(parent));
    expect(await resolve('reply-9')).toEqual({
      kind: 'thread_reply',
      threadId: 'root-9',
    });
    expect(mocks.fetchResolved).toHaveBeenCalledWith(parent(), 'reply-9');
    mocks.host = {};
  });

  it('places a linked reply the device holds only in its root’s thread preview', async () => {
    posthog.__setFlag({ enabled: true, loading: false });
    const root = graphqlMessage(1);
    // A preview stores the reply's own fields, without its thread and call.
    const {
      thread: _thread,
      call: _call,
      ...reply
    } = graphqlMessage(2, {
      threadId: root.id,
    });
    mocks.host = completeRecordsOnly(fakeHost([], { records: [root] }), [
      reply,
    ]);
    const [parent] = createSignal({ type: 'channel' as const, id: CHANNEL_ID });

    const resolve = createRoot(() => useChannelMessageResolver(parent));
    expect(await resolve(reply.id)).toEqual({
      kind: 'thread_reply',
      threadId: root.id,
    });
    expect(mocks.fetchResolved).not.toHaveBeenCalled();
    mocks.host = {};
  });

  it('asks the server when the device cannot be read', async () => {
    posthog.__setFlag({ enabled: true, loading: false });
    mocks.host = {
      ...fakeHost([]),
      readRecordsByKeys: () => Promise.reject(new Error('cache timed out')),
    };
    mocks.fetchResolved.mockResolvedValueOnce({
      kind: 'thread_reply',
      thread_id: 'root-9',
    });
    const [parent] = createSignal({ type: 'channel' as const, id: CHANNEL_ID });

    const resolve = createRoot(() => useChannelMessageResolver(parent));
    expect(await resolve('reply-9')).toEqual({
      kind: 'thread_reply',
      threadId: 'root-9',
    });
    mocks.host = {};
  });
});
