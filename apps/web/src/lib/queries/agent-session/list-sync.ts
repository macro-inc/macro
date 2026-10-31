import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  getSoupEntityById,
  hasSoupEntity,
  hydrateSoupEntity,
} from '@queries/soup/normalized-cache';
import { refreshSoupEntities } from '@queries/soup/refresh';
import { AgentSessionRowDocument } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  graphqlSoupSessionActive,
  mapGraphqlAgentSessionRow,
} from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';

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
        { sessionId, signedIn: graphqlSoupSessionActive() },
        { requestPolicy: 'network-only' }
      )
      .toPromise();
    if (result.error) {
      span.error(result.error);
      throw result.error;
    }
    const session = result.data?.agentSession;
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
  const graphqlLists = isFeatureEnabled(enableGraphqlSoup);
  const held = sessions.filter((id) => graphqlLists || hasSoupEntity(id));
  if (held.length === 0) return;
  const client = getGraphqlSoupClient();
  const reads = await Promise.allSettled(
    held.map((sessionId) => readSessionRow(parent, client, sessionId))
  );
  const failed = reads.find((read) => read.status === 'rejected');
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
      await span.span('agent_session.lists_refetch', () =>
        refreshSoupEntities(sessions, { throwOnError: true })
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
 * lists refetch, then the session's own row is read from the primary.
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
