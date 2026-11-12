import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { accessRequestsClient } from '@service-storage/access-requests';
import type { ShareEntity } from '@service-storage/generated/schemas/shareEntity';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { useQueries, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { revalidateActivityQueries } from '../activity/push-registry';
import { agentSessionKeys } from '../agent-session/keys';
import { callKeys } from '../call/keys';
import { queryClient } from '../client';
import { invalidateExternalChat } from '../external-chats';
import { harnessKeys } from '../harnesses/keys';
import { refreshActiveGraphqlPreviewQueries } from '../preview/active-queries';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';
import { soupKeys } from '../soup/keys';
import { invalidateAllSoup } from '../soup/normalized-cache';
import { databasesKeys, entityKeys } from '../storage/keys';
import { accessRequestKeys } from './keys';

export function fetchAccessRequestState(entity: ShareEntity, offset = 0) {
  return throwOnErr(() => accessRequestsClient.state(entity, offset));
}
/**
 * When an observer reads the state again: `mount` on every mount, since a
 * cached state can predate an access change; `caller` only when the caller
 * asks, for one that knows whether the cached state is current.
 */
export type AccessRequestStateRead = 'mount' | 'caller';

const ACCESS_REQUEST_STATE_READS: Record<
  AccessRequestStateRead,
  { staleTime: number; refetchOnMount: boolean | 'always' }
> = {
  mount: { staleTime: 0, refetchOnMount: 'always' },
  caller: { staleTime: Infinity, refetchOnMount: false },
};

function accessRequestStateOptions(
  target: ShareEntity | undefined,
  enabled: boolean,
  offset: number,
  read: AccessRequestStateRead
) {
  return {
    queryKey: accessRequestKeys
      .entity(target?.entityType ?? '', target?.entityId ?? '')
      ._ctx.state(offset).queryKey,
    queryFn: () => {
      if (!target) throw new Error('No item selected');
      return fetchAccessRequestState(target, offset);
    },
    enabled: !!target && enabled,
    ...ACCESS_REQUEST_STATE_READS[read],
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
    refetchInterval: 30_000,
    throwOnError: false,
  };
}
export function invalidateAccessRequests(entity: ShareEntity) {
  return queryClient.invalidateQueries({
    queryKey: accessRequestKeys.entity(entity.entityType, entity.entityId)
      .queryKey,
  });
}
export function refreshSharedAccess(entity: ShareEntity) {
  fireAndForget(invalidateAccessRequests(entity), 'access-requests');
  if (entity.entityType === 'external_chat') {
    invalidateExternalChat(entity.entityId);
    return;
  }
  // A runtime appears in no list but the runtime queries.
  if (entity.entityType === 'harness') {
    queryClient.invalidateQueries({ queryKey: harnessKeys.list.queryKey });
    queryClient.invalidateQueries({ queryKey: harnessKeys.directory.queryKey });
    return;
  }
  // Permissions change list membership even when the item was never cached.
  invalidateAllSoup();
  queryClient.invalidateQueries({ queryKey: soupKeys.search._def });
  fireAndForget(refreshActiveGraphqlSoupQueries(), 'access-requests');
  const includesDescendants = entity.entityType === 'project';
  fireAndForget(
    refreshActiveGraphqlPreviewQueries(
      includesDescendants ? undefined : entity.entityId
    ),
    'access-requests'
  );
  fireAndForget(
    revalidateActivityQueries(
      getGraphqlSoupClient(),
      includesDescendants ? null : new Set([entity.entityId])
    ),
    'access-requests'
  );
  if (entity.entityType === 'database') {
    queryClient.invalidateQueries({
      queryKey: databasesKeys.detail(entity.entityId).queryKey,
    });
    queryClient.invalidateQueries({
      queryKey: databasesKeys.list.queryKey,
    });
  }
  if (entity.entityType === 'call')
    queryClient.invalidateQueries({ queryKey: callKeys._def });
  if (entity.entityType === 'agent_session')
    queryClient.invalidateQueries({
      queryKey: agentSessionKeys.detail(entity.entityId).queryKey,
    });
  if (entity.entityType === 'project') {
    // A folder grant changes effective access on its descendants too.
    queryClient.invalidateQueries({ queryKey: accessRequestKeys._def });
    queryClient.invalidateQueries({ queryKey: entityKeys._def });
  }
  if (entity.entityType === 'document') {
    queryClient.invalidateQueries({
      queryKey: entityKeys.documentMetadata(entity.entityId).queryKey,
    });
    queryClient.invalidateQueries({
      queryKey: entityKeys.documentAccessLevel(entity.entityId).queryKey,
    });
  }
}
export function useAccessRequestState(
  entity: Accessor<ShareEntity | undefined>,
  enabled: Accessor<boolean> = () => true,
  offset: Accessor<number> = () => 0,
  read: AccessRequestStateRead = 'mount'
) {
  return useQuery(() =>
    accessRequestStateOptions(entity(), enabled(), offset(), read)
  );
}
/**
 * The first page of each entity's access-request state, sharing the cache
 * the entity's own Share menu and rows read.
 */
export function useAccessRequestStates(
  entities: Accessor<ShareEntity[]>,
  enabled: Accessor<boolean> = () => true
) {
  return useQueries(() => ({
    queries: entities().map((entity) =>
      accessRequestStateOptions(entity, enabled(), 0, 'mount')
    ),
  }));
}
export { accessRequestsClient };
