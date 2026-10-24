import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { accessRequestsClient } from '@service-storage/access-requests';
import type { ShareEntity } from '@service-storage/generated/schemas/shareEntity';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { revalidateActivityQueries } from '../activity/push-registry';
import { agentSessionKeys } from '../agent-session/keys';
import { invalidateCalendarEventPreviews } from '../calendar/mention-preview';
import { callKeys } from '../call/keys';
import { channelKeys } from '../channel/keys';
import { queryClient } from '../client';
import { messageKeys } from '../messages/keys';
import { refreshActiveGraphqlPreviewQueries } from '../preview/active-queries';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';
import { soupKeys } from '../soup/keys';
import { invalidateAllSoup } from '../soup/normalized-cache';
import { databasesKeys, entityKeys } from '../storage/keys';
import { accessRequestKeys } from './keys';

/**
 * An item whose access changed. Calendar events and channels have no Share
 * surface of their own, but people lose them when an event is hidden or they
 * leave a channel.
 */
export type AccessChangeEntity =
  | ShareEntity
  | { entityType: 'calendar_event' | 'channel'; entityId: string };

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
export function invalidateAccessRequests(entity: AccessChangeEntity) {
  return queryClient.invalidateQueries({
    queryKey: accessRequestKeys.entity(entity.entityType, entity.entityId)
      .queryKey,
  });
}
export function refreshSharedAccess(entity: AccessChangeEntity) {
  fireAndForget(invalidateAccessRequests(entity), 'access-requests');
  // Permissions change list membership even when the item was never cached.
  invalidateAllSoup();
  queryClient.invalidateQueries({ queryKey: soupKeys.search._def });
  fireAndForget(refreshActiveGraphqlSoupQueries(), 'access-requests');
  // A folder grant reaches what it holds, and a channel what was shared there.
  const includesDescendants =
    entity.entityType === 'project' || entity.entityType === 'channel';
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
  if (entity.entityType === 'calendar_event')
    invalidateCalendarEventPreviews(entity.entityId);
  if (entity.entityType === 'channel') {
    for (const key of [
      channelKeys.listChannels,
      channelKeys.activity,
      channelKeys.withID(entity.entityId),
      channelKeys.participants(entity.entityId),
      channelKeys.attachments(entity.entityId),
      channelKeys.mentions(entity.entityId),
      channelKeys.channelBots(entity.entityId),
    ])
      queryClient.invalidateQueries({ queryKey: key.queryKey });
    // An open conversation closes once its timeline is refused.
    queryClient.invalidateQueries({
      queryKey: [
        ...messageKeys.messages._def,
        { type: 'channel', id: entity.entityId },
      ],
    });
    // Events shared with the channel left with it.
    invalidateCalendarEventPreviews();
  }
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
