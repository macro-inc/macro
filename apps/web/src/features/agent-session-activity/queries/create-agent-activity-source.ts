import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import {
  type AgentActivityPage,
  EntityType,
} from '@service-agent-harness/generated/schemas';
import { AgentSessionActivityAppendedDocument } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  subscribeGraphqlSoupReconnected,
} from '@service-storage/graphql-soup';
import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type {
  AgentActivityRow,
  AgentActivitySource,
} from '../context/agent-activity-source';
import { agentSessionActivityKeys } from './keys';

type Cursor = NonNullable<AgentActivityPage['nextCursor']>;

function activityOptions(sessionId: string) {
  return infiniteQueryOptions({
    queryKey: agentSessionActivityKeys.session(sessionId).queryKey,
    enabled: Boolean(sessionId),
    initialPageParam: undefined as Cursor | undefined,
    queryFn: ({ pageParam, signal }) =>
      Telemetry.span('agent_session.activity.read', async (span) => {
        span.setAttr('agent.session.id', sessionId);
        return throwOnErr(() => {
          const params = new URLSearchParams();
          if (pageParam) {
            params.set('beforeAt', pageParam.occurredAt);
            params.set('beforeId', pageParam.id);
          }
          const query = params.toString() ? `?${params}` : '';
          return fetchWithToken<AgentActivityPage>(
            `${SERVER_HOSTS['agent-harness']}/agent-sessions/${sessionId}/activity${query}`,
            { method: 'GET', signal }
          );
        });
      }),
    getNextPageParam: (page: AgentActivityPage) => page.nextCursor ?? undefined,
    staleTime: 0,
    retry: false,
  });
}

function fromStoredRow(
  row: AgentActivityPage['activities'][number]
): AgentActivityRow {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    verb: null, // TODO(activity-verb): read row.agent_verb after OpenAPI regeneration.
    occurredAt: row.occurred_at,
  };
}

/** One session's REST history with live activity merged by stable row id. */
export function createAgentActivitySource(
  sessionId: Accessor<string | undefined>,
  client: Pick<Client, 'subscription'> = getGraphqlSoupClient()
): AgentActivitySource {
  const [live, setLive] = createSignal<AgentActivityRow[]>([]);
  const [retryEpoch, setRetryEpoch] = createSignal(0);
  const query = useInfiniteQuery(() => activityOptions(sessionId() ?? ''));

  createEffect(on(sessionId, () => setLive([])));

  createEffect(() => {
    const id = sessionId();
    retryEpoch();
    if (!id) return;

    const subscription = client
      .subscription(AgentSessionActivityAppendedDocument, { sessionId: id })
      .subscribe((result) => {
        if (result.error) {
          fireAndForget(
            (async () => {
              await queryClient.invalidateQueries({
                queryKey: agentSessionActivityKeys.session(id).queryKey,
              });
              if (
                sessionId() === id &&
                result.error?.message.includes('behind')
              ) {
                setRetryEpoch((value) => value + 1);
              }
            })(),
            'agent-session-activity-subscription'
          );
          return;
        }
        const rows = result.data?.agentSessionActivityAppended;
        if (!rows) return;
        if (rows.length === 0) {
          fireAndForget(
            queryClient.invalidateQueries({
              queryKey: agentSessionActivityKeys.session(id).queryKey,
            }),
            'agent-session-activity-listening'
          );
          return;
        }
        setLive((current) => {
          const byId = new Map(current.map((row) => [row.id, row]));
          for (const row of rows) {
            if (row.actionTag === 'opened') continue;
            const entityType = Object.values(EntityType).find(
              (value) => value === row.entityType.toLowerCase()
            );
            if (!entityType) continue;
            byId.set(row.id, {
              id: row.id,
              entityType,
              entityId: row.entityId,
              action: row.actionTag,
              verb: row.agentVerb ?? null,
              occurredAt: row.occurredAt,
            });
          }
          return [...byId.values()];
        });
      });
    const unsubscribeReconnect = subscribeGraphqlSoupReconnected(() => {
      fireAndForget(
        queryClient.invalidateQueries({
          queryKey: agentSessionActivityKeys.session(id).queryKey,
        }),
        'agent-session-activity-reconnect'
      );
    });
    onCleanup(() => {
      subscription.unsubscribe();
      unsubscribeReconnect();
    });
  });

  const rows = createMemo(() => {
    const byId = new Map<string, AgentActivityRow>();
    for (const page of query.data?.pages ?? []) {
      for (const stored of page.activities) {
        if (stored.action === 'opened') continue;
        const row = fromStoredRow(stored);
        byId.set(row.id, row);
      }
    }
    for (const row of live()) byId.set(row.id, row);
    return [...byId.values()].sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id)
    );
  });

  return {
    rows,
    isPending: () => query.isPending,
    hasMore: () => Boolean(query.hasNextPage),
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        fireAndForget(query.fetchNextPage(), 'agent-session-activity-page');
      }
    },
  };
}
