/**
 * The session log over GraphQL, through the normalized cache.
 *
 * `cache-and-network` answers twice: from disk when the cache holds the log,
 * then from the network, which the exchange writes back. The caller hears
 * both in order. Rows the socket delivers after the fetch are appended to
 * the cached list here, so the next open starts from a log as complete as
 * the last one ended.
 */

import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type {
  AgentSessionLogEntryDto,
  LogDirectionDto,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import {
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
  /** Stop listening. Unsettled promises settle as a miss and a failure. */
  stop: () => void;
};

const DIRECTIONS: ReadonlySet<string> = new Set<LogDirectionDto>([
  'to_server',
  'to_runtime',
]);

function isDirection(value: string): value is LogDirectionDto {
  return DIRECTIONS.has(value);
}

type LogData = NonNullable<AgentSessionLogQuery['user']['agentSession']>['log'];

/** The wire shape the fold reads, from the GraphQL selection. */
function toSnapshot(sessionId: string, log: LogData): SessionLogSnapshot {
  return {
    bot: {
      id: log.bot.id,
      name: log.bot.name,
      handle: log.bot.handle,
      ...(log.bot.avatarUrl === null ? {} : { avatarUrl: log.bot.avatarUrl }),
    },
    rows: log.entries.map((entry) => {
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
    }),
  };
}

/**
 * Watch one session's log: the cached copy first when there is one, then
 * the fetched one. `policy` `network-only` skips the cache read, for a
 * resync that wants only what the server holds.
 */
export function watchAgentSessionLog(
  sessionId: string,
  policy: 'cache-and-network' | 'network-only' = 'cache-and-network'
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
      resolveFetched(toSnapshot(sessionId, log));
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
      resolveCached(undefined);
      rejectFetched(new AgentSessionLogUnavailable(sessionId, 'failed'));
    },
  };
}

const LOG_QUERY = stringifyDocument(AgentSessionLogDocument);
const LOG_OPERATION = 'AgentSessionLog';

/**
 * Append rows the socket delivered to the cached log, so the next open
 * folds them before the network answers. A cache without this session's
 * log has nothing to extend; the next fetch writes the whole thing.
 */
export async function appendAgentSessionLogRows(
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
