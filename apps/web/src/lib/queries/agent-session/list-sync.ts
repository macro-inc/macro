import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import {
  getSoupEntityById,
  hydrateSoupEntity,
} from '@queries/soup/normalized-cache';
import { refreshSoupEntities } from '@queries/soup/refresh';
import { AgentSessionRowDocument } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  mapGraphqlAgentSessionRow,
} from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import { NIL as NIL_UUID } from 'uuid';

const changedSessions = new Set<string>();
let pending: Promise<void> | undefined;

/** Read one session's row from the primary and apply it to the lists. */
function readSessionRow(
  parent: Span,
  client: Client,
  sessionId: string
): Promise<void> {
  return parent.span('agent_session.row_read', async (span) => {
    span.setAttr('agent_session.id', sessionId);
    const result = await client
      .query(
        AgentSessionRowDocument,
        { sessionId },
        { requestPolicy: 'network-only' }
      )
      .toPromise();
    if (result.error) {
      span.error(result.error);
      throw result.error;
    }
    const session = result.data?.user.agentSession;
    span.setAttr('agent_session.turn_state', session?.turnState ?? 'absent');
    const cached = session && getSoupEntityById(session.id);
    if (!session || cached?.tag !== 'agentSession') {
      span.setAttr('agent_session.row_read.rest_hydrated', false);
      return;
    }
    hydrateSoupEntity({
      tag: 'agentSession',
      frecency_score: cached.frecency_score,
      data: mapGraphqlAgentSessionRow(session),
    });
    span.setAttr('agent_session.row_read.rest_hydrated', true);
  });
}

/**
 * Read each session's row from the primary and apply it to every list holding
 * it: GraphQL lists share the normalized record the read writes, REST lists
 * the normalized entity hydrated from it. Runs after the REST list refetch,
 * which reads a replica that can still return the row from before the change.
 * Every read settles before a failure reaches the retry, so a late read cannot
 * land after the retry's newer one.
 */
async function readSessionRows(
  parent: Span,
  sessions: string[]
): Promise<void> {
  if (sessions.length === 0) return;
  const client = getGraphqlSoupClient();
  const reads = await Promise.allSettled(
    sessions.map((sessionId) => readSessionRow(parent, client, sessionId))
  );
  const failed = reads.find((read) => read.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Only a positive nil `id`, possibly AND-ed with anything, proves a session
 * filter selects nothing (`compileClause` excludes a target that way). */
function excludesAgentSessions(ast: unknown): boolean {
  if (!isRecord(ast)) return false;
  const and = ast['&'];
  if (Array.isArray(and)) return and.some(excludesAgentSessions);
  return isRecord(ast.l) && ast.l.id === NIL_UUID;
}

/** Whether a Soup list's REST-shaped filter body can contain agent sessions. */
function listCanIncludeAgentSessions(body: unknown): boolean {
  return isRecord(body) && !excludesAgentSessions(body.asf);
}

/**
 * Refetch the lists holding these sessions. REST lists refetch by entity.
 * GraphQL lists normally need nothing: the row read writes the record the
 * normalized cache keeps them on (FE-58). Without the cache there is no such
 * record, so they refetch too; otherwise a list such as Quick Access's sessions
 * keeps the old name until the page reloads.
 */
async function refetchLists(span: Span, sessions: string[]): Promise<void> {
  const rest = refreshSoupEntities(sessions, { throwOnError: true });
  const cached = Boolean(getGraphqlCacheHost());
  span.setAttr('agent_session.lists_refetch.graphql', !cached);
  if (cached) return await rest;
  // Settle both before a retry, so an older pass cannot land after it.
  const results = await Promise.allSettled([
    rest,
    refreshActiveGraphqlSoupQueries({
      throwOnError: true,
      where: listCanIncludeAgentSessions,
    }),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/**
 * One pass over a batch: the REST list refetch, then the primary row reads.
 * The phases start from the pass's span, not the ambient context, which does
 * not survive an `await`.
 */
function refreshBatch(sessions: string[], attempt: number): Promise<void> {
  return Telemetry.span('agent_session.lists_refresh', async (span) => {
    span.setAttr('agent_session.ids', sessions.join(','));
    span.setAttr('agent_session.count', sessions.length);
    span.setAttr('agent_session.lists_refresh.attempt', attempt);
    try {
      await span.span('agent_session.lists_refetch', (refetch) =>
        refetchLists(refetch, sessions)
      );
      await readSessionRows(span, sessions);
    } catch (error) {
      span.error(error);
      throw error;
    }
  });
}

async function refreshQueuedLists(resolve: () => void): Promise<void> {
  let retryAvailable = true;
  try {
    while (changedSessions.size) {
      const sessions = [...changedSessions];
      changedSessions.clear();
      try {
        await refreshBatch(sessions, retryAvailable ? 1 : 2);
      } catch (error) {
        for (const session of sessions) changedSessions.add(session);
        if (!retryAvailable) throw error;
        retryAvailable = false;
      }
    }
  } catch (error) {
    // Gateway event handlers are fire-and-forget. Report exhaustion without
    // rejecting their unobserved promises; the queued batch remains intact.
    console.error('[agent-session] failed to refresh session lists', error);
  } finally {
    pending = undefined;
    resolve();
  }
}

/**
 * Refresh the lists that show a session after its metadata changes: REST
 * lists (and GraphQL lists, without the normalized cache) refetch, then the
 * session's own row is read from the primary.
 * A burst shares one pass; updates committed during a fetch get a later pass.
 * A failed pass retries once with queued updates. Further failures retain the
 * batch for the next event instead of dropping it or spinning.
 */
export function refreshAgentSessionLists(sessionId: string): Promise<void> {
  changedSessions.add(sessionId);

  if (!pending) {
    pending = new Promise<void>((resolve) => {
      queueMicrotask(() =>
        fireAndForget(refreshQueuedLists(resolve), 'agent-session-lists')
      );
    });
  }
  return pending;
}
