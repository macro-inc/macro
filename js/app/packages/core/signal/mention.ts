import { ENABLE_MENTION_TRACKING } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import type { ItemType } from '@service-storage/client';
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

  const response = await commsServiceClient.createEntityMention(
    {
      source_entity_type: 'document',
      source_entity_id: sourceId,
      entity_type: targetType,
      entity_id: targetId,
    },
    token
  );

  if (isErr(response)) {
    console.error('Failed to track document mention', response);
    return;
  }

  return response[1]?.id;
}

export async function untrackMention(
  sourceId: string,
  mentionId: MentionId
): Promise<void> {
  if (!ENABLE_MENTION_TRACKING) return;
  const token = await getPermissionToken('document', sourceId);
  if (!token) return;

  const response = await commsServiceClient.deleteEntityMention(
    {
      mention_id: mentionId,
    },
    token
  );

  if (isErr(response)) {
    console.error('Failed to untrack document mention', response);
  }
}
