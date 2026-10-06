/**
 * The session log over GraphQL, through the normalized cache.
 *
 * `cache-and-network` answers twice: from disk when the cache holds the log,
 * then from the network, which the exchange writes back. The caller hears
 * both in order. A watch that follows the session subscribes to its appended
 * frames before the query goes out, so no row between the two is lost, and
 * appends what the subscription delivers to the cached list, so the next
 * open starts from a log as complete as the last one ended.
 */

import { traceCacheWrite } from '@core/agent-session/load-telemetry';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type {
  AgentSessionLogEntryDto,
  LogDirectionDto,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import {
  AgentSessionLogAppendedDocument,
  type AgentSessionLogAppendedSubscription,
  type AgentSessionLogAppendedSubscriptionVariables,
  AgentSessionLogDocument,
  type AgentSessionLogQuery,
  type AgentSessionLogQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { type OperationResult, stringifyDocument } from '@urql/core';
import { pipe, subscribe } from 'wonka';

/** What the fold needs: the agent and the raw rows. */
export type SessionLogSnapshot = {
  bot: SessionBot;
  rows: AgentSessionLogEntryDto[];
};

/**
 * The log could not be served. `reason` separates a session the viewer
 * cannot see (or that does not exist) from a transport failure that a
 * retry could fix.
 */
export class AgentSessionLogUnavailable extends Error {
  constructor(
    readonly sessionId: string,
    readonly reason: 'inaccessible' | 'failed',
    options?: ErrorOptions
  ) {
    super(`agent session log is ${reason}: ${sessionId}`, options);
    this.name = 'AgentSessionLogUnavailable';
  }
}

export type SessionLogWatch = {
  /**
   * The log as the cache last held it, or nothing when the cache has no
   * copy or the network answered first. Never rejects.
   */
  cached: Promise<SessionLogSnapshot | undefined>;
  /** The log as the server holds it now. Rejects with {@link AgentSessionLogUnavailable}. */
  fetched: Promise<SessionLogSnapshot>;
  /**
   * Stop listening. Unsettled promises settle as a miss and a failure; a
   * follow is unsubscribed and what it still owes the cache is written.
   */
  stop: () => void;
};

/**
 * How a watch follows the session after the fetch: each run of frames the
 * harness appends, in log order, as the harness flushed it. `gap` means
 * rows may have been missed - the subscription fell behind or the socket
 * reconnected - and the caller must refetch the log.
 */
export type SessionLogFollow = {
  rows: (rows: AgentSessionLogEntryDto[]) => void;
  gap: () => void;
};

/**
 * Whether a watch can follow the session over GraphQL. Only the client
 * built with the Soup websocket carries subscriptions; without it, live
 * rows still arrive through the connection gateway.
 */
export function canFollowAgentSessionLog(): boolean {
  return isFeatureEnabled(enableGraphqlSoup);
}

const DIRECTIONS: ReadonlySet<string> = new Set<LogDirectionDto>([
  'to_server',
  'to_runtime',
]);

function isDirection(value: string): value is LogDirectionDto {
  return DIRECTIONS.has(value);
}

type LogData = NonNullable<AgentSessionLogQuery['user']['agentSession']>['log'];
type LogEntry = LogData['entries'][number];

/** One GraphQL entry in the wire shape the fold reads. */
function toRow(sessionId: string, entry: LogEntry): AgentSessionLogEntryDto {
  if (!isDirection(entry.direction)) {
    throw new AgentSessionLogUnavailable(sessionId, 'failed', {
      cause: new Error(`unknown log direction: ${entry.direction}`),
    });
  }
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    ...(entry.userId === null ? {} : { userId: entry.userId }),
    direction: entry.direction,
    content: entry.content as AgentSessionLogEntryDto['content'],
  };
}

/** The wire shape the fold reads, from the GraphQL selection. */
function toSnapshot(sessionId: string, log: LogData): SessionLogSnapshot {
  return {
    bot: {
      id: log.bot.id,
      name: log.bot.name,
      handle: log.bot.handle,
      ...(log.bot.avatarUrl === null ? {} : { avatarUrl: log.bot.avatarUrl }),
    },
    rows: log.entries.map((entry) => toRow(sessionId, entry)),
  };
}

/** How long appended rows wait for company before they are written. */
const CACHE_WRITE_DEBOUNCE_MS = 1_000;

/**
 * Watch one session's log: the cached copy first when there is one, then
 * the fetched one. `policy` `network-only` skips the cache read, for a
 * resync that wants only what the server holds. With `follow`, the watch
 * also subscribes to the session's appended frames, before the query so
 * the two overlap rather than leave a hole, and hands each run on.
 */
export function watchAgentSessionLog(
  sessionId: string,
  policy: 'cache-and-network' | 'network-only' = 'cache-and-network',
  follow?: SessionLogFollow
): SessionLogWatch {
  let resolveCached!: (snapshot: SessionLogSnapshot | undefined) => void;
  let resolveFetched!: (snapshot: SessionLogSnapshot) => void;
  let rejectFetched!: (error: AgentSessionLogUnavailable) => void;
  const cached = new Promise<SessionLogSnapshot | undefined>((resolve) => {
    resolveCached = resolve;
  });
  const fetched = new Promise<SessionLogSnapshot>((resolve, reject) => {
    resolveFetched = resolve;
    rejectFetched = reject;
  });
  // A rejection nobody has awaited yet must not be reported as unhandled.
  fetched.catch(() => undefined);

  const appender = follow ? createAppender(sessionId) : undefined;
  const unsubscribeFollow = follow
    ? followAppended(sessionId, follow, appender)
    : () => undefined;

  const settleFetched = (result: OperationResult<AgentSessionLogQuery>) => {
    resolveCached(undefined);
    if (result.error) {
      rejectFetched(
        new AgentSessionLogUnavailable(sessionId, 'failed', {
          cause: result.error,
        })
      );
      return;
    }
    const log = result.data?.user.agentSession?.log;
    if (!log) {
      rejectFetched(new AgentSessionLogUnavailable(sessionId, 'inaccessible'));
      return;
    }
    try {
      const snapshot = toSnapshot(sessionId, log);
      appender?.fetched(snapshot.rows);
      resolveFetched(snapshot);
    } catch (error) {
      rejectFetched(
        error instanceof AgentSessionLogUnavailable
          ? error
          : new AgentSessionLogUnavailable(sessionId, 'failed', {
              cause: error,
            })
      );
    }
  };

  const { unsubscribe } = pipe(
    getGraphqlSoupClient().query<
      AgentSessionLogQuery,
      AgentSessionLogQueryVariables
    >(AgentSessionLogDocument, { sessionId }, { requestPolicy: policy }),
    subscribe((result) => {
      const source = normalizedCacheResultMetadata(result)?.source;
      const fromCache =
        source === 'normalized-cache-hit' ||
        source === 'affected-cache-reread' ||
        result.stale;
      if (fromCache) {
        const log = result.data?.user.agentSession?.log;
        // A cached miss or a cached refusal is not worth folding; the
        // network answer settles both.
        if (log && !result.error) {
          try {
            resolveCached(toSnapshot(sessionId, log));
          } catch {
            resolveCached(undefined);
          }
        }
        return;
      }
      settleFetched(result);
      unsubscribe();
    })
  );

  return {
    cached,
    fetched,
    stop: () => {
      unsubscribe();
      unsubscribeFollow();
      appender?.flush();
      resolveCached(undefined);
      rejectFetched(new AgentSessionLogUnavailable(sessionId, 'failed'));
    },
  };
}

/**
 * Subscribe to the session's appended frames. Every run reaches `follow`
 * at once; the appender hears it too, to keep the cached log in step. An
 * error or an end from the server is a gap: the subscription fell behind,
 * and the rows it dropped are only in the durable log.
 */
function followAppended(
  sessionId: string,
  follow: SessionLogFollow,
  appender: Appender | undefined
): () => void {
  const { unsubscribe } = pipe(
    getGraphqlSoupClient().subscription<
      AgentSessionLogAppendedSubscription,
      AgentSessionLogAppendedSubscriptionVariables
    >(AgentSessionLogAppendedDocument, { sessionId }),
    subscribe((result) => {
      if (result.error) {
        console.warn(
          '[agent-session] log subscription interrupted',
          result.error
        );
        follow.gap();
        return;
      }
      const entries = result.data?.agentSessionLogAppended;
      if (!entries || entries.length === 0) return;
      let rows: AgentSessionLogEntryDto[];
      try {
        rows = entries.map((entry) => toRow(sessionId, entry));
      } catch (error) {
        console.warn('[agent-session] log subscription row unreadable', error);
        follow.gap();
        return;
      }
      appender?.appended(rows);
      follow.rows(rows);
    })
  );
  return unsubscribe;
}

type Appender = {
  /** The fetched log landed in the cache; rows held until now go after it. */
  fetched: (rows: AgentSessionLogEntryDto[]) => void;
  /** The subscription delivered a run. */
  appended: (rows: AgentSessionLogEntryDto[]) => void;
  /** Write now what a pending timer would have. */
  flush: () => void;
};

/**
 * Keep the cached log in step with what the subscription delivered, once
 * the fetched log is what the cache holds. The exchange writes each fetched
 * snapshot itself; only rows after one need appending. Rows that arrive
 * before the fetch settles wait: written earlier, the fetched write would
 * replace the list without them. Dedupes by row id, as the fold does, so a
 * row delivered twice is stored once.
 */
function createAppender(sessionId: string): Appender {
  let known: Set<string> | undefined;
  let pending: AgentSessionLogEntryDto[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = () => {
    const rows = pending;
    if (rows.length === 0) return;
    pending = [];
    const startedAt = performance.now();
    void appendAgentSessionLogRows(sessionId, rows).then(
      () => traceCacheWrite(sessionId, startedAt, rows.length),
      (error: unknown) => {
        console.warn('[agent-session] log rows could not be cached', error);
      }
    );
  };
  const schedule = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      write();
    }, CACHE_WRITE_DEBOUNCE_MS);
  };
  const remember = (rows: AgentSessionLogEntryDto[]) => {
    if (!known) return false;
    let changed = false;
    for (const row of rows) {
      if (known.has(row.id)) continue;
      known.add(row.id);
      pending.push(row);
      changed = true;
    }
    return changed;
  };

  return {
    fetched(rows) {
      known = new Set(rows.map((row) => row.id));
      const held = pending;
      pending = [];
      if (remember(held)) schedule();
    },
    appended(rows) {
      if (!known) {
        pending.push(...rows);
        return;
      }
      if (remember(rows)) schedule();
    },
    flush() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      write();
    },
  };
}

const LOG_QUERY = stringifyDocument(AgentSessionLogDocument);
const LOG_OPERATION = 'AgentSessionLog';

/**
 * Append rows to the cached log, so the next open folds them before the
 * network answers. A cache without this session's log has nothing to
 * extend; the next fetch writes the whole thing.
 */
async function appendAgentSessionLogRows(
  sessionId: string,
  rows: AgentSessionLogEntryDto[]
): Promise<void> {
  const host = getGraphqlCacheHost();
  if (!host || rows.length === 0) return;
  const args = {
    query: LOG_QUERY,
    operationName: LOG_OPERATION,
    variables: { sessionId } satisfies AgentSessionLogQueryVariables,
  };
  const read = await host.readQuery({ ...args, priority: 'user-visible' });
  if (read.kind !== 'hit') return;
  // The generated document defines the normalized cache result's shape.
  const data = read.data as AgentSessionLogQuery;
  const log = data.user.agentSession?.log;
  if (!log) return;
  const known = new Set(log.entries.map((entry) => entry.id));
  const appended = rows
    .filter((row) => !known.has(row.id))
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      userId: row.userId ?? null,
      direction: row.direction,
      content: row.content,
    }));
  if (appended.length === 0) return;
  await host.writeQuery({
    ...args,
    data: {
      user: {
        id: data.user.id,
        agentSession: {
          id: sessionId,
          log: { bot: log.bot, entries: [...log.entries, ...appended] },
        },
      },
    } satisfies AgentSessionLogQuery,
  });
}

/** Drop the cached session so nothing renders for a viewer who was refused. */
export async function forgetAgentSessionLog(sessionId: string): Promise<void> {
  const host = getGraphqlCacheHost();
  if (!host) return;
  await host.deleteRecords([`GraphqlSoupAgentSession:${sessionId}`]);
}
