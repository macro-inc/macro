import { ENABLE_MENTION_TRACKING } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryClient } from '@queries/client';
import { refreshCrmAssociatedSoupQueries } from '@queries/soup/crm-association';
import { attachmentReferencesKeys } from '@queries/storage/keys';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import { getPermissionToken } from './token';

type MentionId = string;

/** CRM records whose associated-item lists include what references them. */
const isCrmTarget = (targetType: string | undefined) =>
  targetType === undefined ||
  targetType === 'crm_company' ||
  targetType === 'crm_contact';

export async function trackMention(
  sourceId: string,
  targetType: ItemType | 'user',
  targetId: string
): Promise<MentionId | undefined> {
  if (!ENABLE_MENTION_TRACKING) return;
  const token = await getPermissionToken('document', sourceId);
  if (!token) return;

  const response = await storageServiceClient.createEntityMention(
    {
      source_entity_type: 'document',
      source_entity_id: sourceId,
      entity_type: targetType,
      entity_id: targetId,
    },
    token
  );

  if (response.isErr()) {
    console.error('Failed to track document mention', response);
    return;
  }

  queryClient.invalidateQueries({
    queryKey: attachmentReferencesKeys.list(targetType, targetId).queryKey,
  });
  if (isCrmTarget(targetType))
    fireAndForget(refreshCrmAssociatedSoupQueries(), 'mention-tracking');
  return response.value?.id;
}

/**
 * Remove a recorded mention. Pass the target type when known so only
 * removals that can change a CRM record's associated items refresh them.
 */
export async function untrackMention(
  sourceId: string,
  mentionId: MentionId,
  targetType?: string
): Promise<void> {
  if (!ENABLE_MENTION_TRACKING) return;
  const token = await getPermissionToken('document', sourceId);
  if (!token) return;

  const response = await storageServiceClient.deleteEntityMention(
    {
      mention_id: mentionId,
    },
    token
  );

  if (response.isErr()) {
    console.error('Failed to untrack document mention', response);
  }

  queryClient.invalidateQueries({
    queryKey: attachmentReferencesKeys.list._def,
  });
  if (isCrmTarget(targetType))
    fireAndForget(refreshCrmAssociatedSoupQueries(), 'mention-tracking');
}
