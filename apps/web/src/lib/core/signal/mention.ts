import { ENABLE_MENTION_TRACKING } from '@core/constant/featureFlags';
import { queryClient } from '@queries/client';
import { attachmentReferencesKeys } from '@queries/storage/keys';

import { type ItemType, storageServiceClient } from '@service-storage/client';
import { getPermissionToken } from './token';

type MentionId = string;

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
  return response.value?.id;
}

export async function untrackMention(
  sourceId: string,
  mentionId: MentionId
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
}
