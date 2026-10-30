import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';

/**
 * The support channels the viewer helps in: every new user's support channel
 * except their own. A new user owns theirs, so it stays among their channels;
 * the Macro team members added to it see it in the Support section instead.
 * Sorted so the set reads the same however the channel list is ordered.
 */
export function supportChannelIds(
  channels: readonly Pick<
    ApiChannelWithLatest,
    'id' | 'is_support' | 'owner_id'
  >[],
  userId: string | undefined
): string[] {
  if (!userId) return [];
  return channels
    .filter((channel) => channel.is_support && channel.owner_id !== userId)
    .map((channel) => channel.id)
    .sort();
}
