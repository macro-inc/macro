import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { accessRequestsClient } from '@service-storage/access-requests';
import type { ShareEntity } from '@service-storage/generated/schemas/shareEntity';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { revalidateActivityQueries } from '../activity/push-registry';
import { agentSessionKeys } from '../agent-session/keys';
import { callKeys } from '../call/keys';
import { queryClient } from '../client';
import { refreshActiveGraphqlPreviewQueries } from '../preview/active-queries';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';
import { invalidateAllSoup } from '../soup/normalized-cache';
import { databasesKeys, entityKeys } from '../storage/keys';
import { accessRequestKeys } from './keys';

export function fetchAccessRequestState(entity: ShareEntity, offset = 0) {
  return throwOnErr(() => accessRequestsClient.state(entity, offset));
}
function accessRequestStateOptions(
  target: ShareEntity | undefined,
  enabled: boolean,
  offset: number
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
    staleTime: 0,
    refetchOnMount: 'always' as const,
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
  // Permissions change list membership even when the item was never cached.
  invalidateAllSoup();
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
  offset: Accessor<number> = () => 0
) {
  return useQuery(() =>
    accessRequestStateOptions(entity(), enabled(), offset())
  );
}
export { accessRequestsClient };
