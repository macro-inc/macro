import { fetchPipelineSharePermissions } from '@app/features/crm/sharing-adapter';
import type { ShareItemType } from '@core/component/TopBar/linkShare';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { storageServiceClient } from '@service-storage/client';
import { queryOptions } from '@tanstack/solid-query';
import { fetchAgentSessionSharePermissions } from '../agent-session/share-permissions';
import { queryClient } from '../client';
import { fetchExternalChatPermissions } from '../external-chats/share-permissions';
import { fetchInitiativeSharePermissions } from '../initiative/share-permissions';
import { getDatabaseSharePermissions } from '../storage/databases';
import { getFormSharePermissions } from '../storage/forms';
import { sharePermissionKeys } from './keys';

// Long enough that hovering Share and then clicking it fetches once; short
// enough that a reopened dialog revalidates grants made elsewhere.
const SHARE_PERMISSIONS_STALE_TIME = 15_000;

/** Reads an item's share permissions from the service that owns it. */
export async function fetchSharePermissions(
  id: string,
  itemType: ShareItemType
) {
  if (itemType === 'external_chat') return fetchExternalChatPermissions(id);
  if (itemType === 'crm_pipeline') return fetchPipelineSharePermissions(id);
  if (itemType === 'agent_session') {
    return fetchAgentSessionSharePermissions(id);
  }
  if (itemType === 'initiative') {
    return fetchInitiativeSharePermissions(id);
  }
  if (itemType === 'database') return getDatabaseSharePermissions(id);
  if (itemType === 'form') return getFormSharePermissions(id);
  if (itemType === 'chat') {
    return cognitionApiServiceClient.getChatPermissions({ id });
  }
  if (itemType === 'document') {
    return storageServiceClient.getDocumentPermissions({ document_id: id });
  }
  if (itemType === 'project') {
    if (id === 'trash') {
      return;
    }
    return storageServiceClient.projects.getPermissions({ id });
  }
}

async function loadSharePermissions(id: string, itemType: ShareItemType) {
  const result = await fetchSharePermissions(id, itemType);
  if (!result) return null;
  // Each owning service returns its own permission shape, so the union can't
  // go through `throwOnErr`; this is the same conversion.
  if (result.isErr()) throw new ThrownResultError(result.error);
  return result.value;
}

export function sharePermissionsQueryOptions(
  id: string,
  itemType: ShareItemType
) {
  return queryOptions({
    queryKey: sharePermissionKeys.entity(itemType, id).queryKey,
    queryFn: () => loadSharePermissions(id, itemType),
    enabled: !!id,
    staleTime: SHARE_PERMISSIONS_STALE_TIME,
  });
}

/** Names of the channels an item is shared with, for the Share dialog roster. */
export function shareChannelNamesQueryOptions(channelIds: readonly string[]) {
  return queryOptions({
    queryKey: sharePermissionKeys.channelNames(channelIds).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.getBatchChannelPreviews({
          channel_ids: [...channelIds],
        })
      ),
    enabled: channelIds.length > 0,
    staleTime: SHARE_PERMISSIONS_STALE_TIME,
  });
}

/** The channel ids a permissions read grants, in a stable order for cache keys. */
export function sharedChannelIds(
  permissions:
    | { channelSharePermissions?: { channel_id: string }[] | null }
    | null
    | undefined
): string[] {
  return (permissions?.channelSharePermissions ?? [])
    .map(({ channel_id }) => channel_id)
    .sort();
}

/**
 * Warms what the Share dialog reads first, so opening it right after hovering
 * or focusing its trigger shows the roster without a network wait.
 */
export async function prefetchSharePermissions(
  id: string,
  itemType: ShareItemType
) {
  if (!id) return;
  const options = sharePermissionsQueryOptions(id, itemType);
  await queryClient.prefetchQuery(options);
  await prefetchShareChannelNames(
    sharedChannelIds(queryClient.getQueryData(options.queryKey))
  );
}

/** Warms the roster's channel names when the permissions are already loaded. */
export async function prefetchShareChannelNames(channelIds: readonly string[]) {
  if (channelIds.length === 0) return;
  await queryClient.prefetchQuery(shareChannelNamesQueryOptions(channelIds));
}

/** Marks every cached share read stale after a share change made elsewhere. */
export function invalidateSharePermissions() {
  queryClient.invalidateQueries({
    queryKey: sharePermissionKeys._def,
  });
}
