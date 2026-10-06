/**
 * The watch against a faked urql client and cache host: a followed watch
 * subscribes before it queries, hands every run on at once, and extends the
 * cached log only once the fetched one is what the cache holds.
 */

import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import type { AgentSessionLogQuery } from '@service-storage/graphql/generated/graphql';
import type { OperationResult } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, type Source } from 'wonka';

vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => true,
}));
vi.mock('@core/agent-session/load-telemetry', () => ({
  traceCacheWrite: () => undefined,
}));

const metadata = vi.hoisted(() => new WeakMap<object, { source: string }>());
vi.mock('@graphql-cache/exchange/normalized-cache-exchange', () => ({
  normalizedCacheResultMetadata: (result: object) => metadata.get(result),
}));

const client = vi.hoisted(() => ({
  query: vi.fn(),
  subscription: vi.fn(),
}));
const host = vi.hoisted(() => ({
  readQuery: vi.fn(),
  writeQuery: vi.fn(),
  deleteRecords: vi.fn(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client,
  getGraphqlCacheHost: () => host,
}));

import { watchAgentSessionLog } from './log';

const SESSION = '01a0abed-279f-724c-9f49-60dbedc79b6e';

function entry(n: number) {
  return {
    id: `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`,
    createdAt: new Date(Date.UTC(2026, 7, 13, 0, 0, n)).toISOString(),
    userId: null,
    direction: 'to_server',
    content: { type: 'acp', jsonrpc: '2.0', id: n },
  };
}

function row(n: number): AgentSessionLogEntryDto {
  const { userId: _userId, ...rest } = entry(n);
  return rest as unknown as AgentSessionLogEntryDto;
}

const bot = { id: 'bot-id', name: 'Agent', handle: 'agent', avatarUrl: null };

function logData(ids: number[]): AgentSessionLogQuery {
  return {
    user: {
      id: 'user-1',
      agentSession: {
        id: SESSION,
        log: { bot, entries: ids.map(entry) },
      },
    },
  };
}

type Result<T> = OperationResult<T>;

/** A result the exchange marked as coming from the network. */
function fromNetwork<T>(data: T): Result<T> {
  const result = { data, stale: false, hasNext: false } as unknown as Result<T>;
  metadata.set(result, { source: 'live-network' });
  return result;
}

/** A result the exchange marked as a cache read. */
function fromCache<T>(data: T): Result<T> {
  const result = { data, stale: false, hasNext: false } as unknown as Result<T>;
  metadata.set(result, { source: 'normalized-cache-hit' });
  return result;
}

let query: ReturnType<typeof makeSubject<Result<AgentSessionLogQuery>>>;
let appended: ReturnType<
  typeof makeSubject<
    Result<{ agentSessionLogAppended: ReturnType<typeof entry>[] }>
  >
>;
/** The order the client was asked for things in. */
let calls: string[];

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  query = makeSubject();
  appended = makeSubject();
  client.query.mockImplementation((): Source<unknown> => {
    calls.push('query');
    return query.source;
  });
  client.subscription.mockImplementation((): Source<unknown> => {
    calls.push('subscription');
    return appended.source;
  });
  host.readQuery.mockResolvedValue({ kind: 'miss' });
  host.writeQuery.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** Let awaited promises settle under fake timers. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('watchAgentSessionLog', () => {
  it('answers from the cache, then the network', async () => {
    const watch = watchAgentSessionLog(SESSION);
    query.next(fromCache(logData([1])));
    query.next(fromNetwork(logData([1, 2])));

    expect((await watch.cached)?.rows).toEqual([row(1)]);
    expect((await watch.fetched).rows).toEqual([row(1), row(2)]);
    expect(client.subscription).not.toHaveBeenCalled();
  });

  it('subscribes before it queries, and hands every run on at once', async () => {
    const rows = vi.fn();
    const watch = watchAgentSessionLog(SESSION, 'cache-and-network', {
      rows,
      gap: () => undefined,
    });
    expect(calls).toEqual(['subscription', 'query']);
    expect(client.subscription).toHaveBeenCalledWith(expect.anything(), {
      sessionId: SESSION,
    });

    appended.next(fromNetwork({ agentSessionLogAppended: [entry(2)] }));
    expect(rows).toHaveBeenCalledWith([row(2)]);
    watch.stop();
  });

  it('extends the cached log after the fetched one, without what it already holds', async () => {
    const watch = watchAgentSessionLog(SESSION, 'cache-and-network', {
      rows: () => undefined,
      gap: () => undefined,
    });
    // Delivered while the query is on the wire: held, not written over a
    // list the fetch is about to replace.
    appended.next(fromNetwork({ agentSessionLogAppended: [entry(2)] }));
    appended.next(fromNetwork({ agentSessionLogAppended: [entry(3)] }));
    await settle();
    expect(host.readQuery).not.toHaveBeenCalled();

    // The fetched log already has row 2.
    query.next(fromNetwork(logData([1, 2])));
    await watch.fetched;
    host.readQuery.mockResolvedValue({ kind: 'hit', data: logData([1, 2]) });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(host.writeQuery).toHaveBeenCalledOnce();
    const written = host.writeQuery.mock.calls[0]?.[0]
      .data as AgentSessionLogQuery;
    expect(
      written.user.agentSession?.log.entries.map((written) => written.id)
    ).toEqual([entry(1).id, entry(2).id, entry(3).id]);
    watch.stop();
  });

  it('writes what it still owes when stopped', async () => {
    const watch = watchAgentSessionLog(SESSION, 'cache-and-network', {
      rows: () => undefined,
      gap: () => undefined,
    });
    query.next(fromNetwork(logData([1])));
    await watch.fetched;
    host.readQuery.mockResolvedValue({ kind: 'hit', data: logData([1]) });
    appended.next(fromNetwork({ agentSessionLogAppended: [entry(2)] }));
    appended.next(fromNetwork({ agentSessionLogAppended: [entry(2)] }));

    watch.stop();
    await settle();

    expect(host.writeQuery).toHaveBeenCalledOnce();
    const written = host.writeQuery.mock.calls[0]?.[0]
      .data as AgentSessionLogQuery;
    expect(written.user.agentSession?.log.entries).toHaveLength(2);
  });

  it('reports a gap when the subscription errors', async () => {
    const gap = vi.fn();
    const watch = watchAgentSessionLog(SESSION, 'cache-and-network', {
      rows: () => undefined,
      gap,
    });
    appended.next({
      error: new Error('closed after falling behind'),
      stale: false,
      hasNext: false,
    } as unknown as Result<{ agentSessionLogAppended: never[] }>);

    expect(gap).toHaveBeenCalledOnce();
    watch.stop();
  });
});
