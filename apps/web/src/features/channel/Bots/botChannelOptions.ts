import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { ChannelType } from '@service-storage/generated/schemas/channelType';

/** A channel a bot can belong to, as shown in bot settings pickers. */
export type BotChannelOption = { id: string; name: string };

type AssignableChannel = Pick<
  ApiChannelWithLatest,
  'id' | 'name' | 'channel_type'
>;

/**
 * Channels offered when assigning a bot — private and team channels, the same
 * types whose participants panel allows managing bots.
 */
export function botAssignableChannelOptions(
  channels: AssignableChannel[]
): BotChannelOption[] {
  return channels
    .filter(
      (channel) =>
        channel.channel_type === ChannelType.private ||
        channel.channel_type === ChannelType.team
    )
    .map((channel) => ({
      id: channel.id,
      name: channel.name?.trim() || 'Unnamed channel',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Union of the channels a bot is already in and the channels the caller can
 * assign. Assigned channels stay listed even when they fall outside the
 * caller's assignable set (e.g. a private channel the caller is not in);
 * dropping them would hide their chips and silently remove those assignments
 * on the next save.
 */
export function mergeChannelOptions(
  assigned: BotChannelOption[],
  assignable: BotChannelOption[]
): BotChannelOption[] {
  const byId = new Map<string, BotChannelOption>();
  for (const option of assigned) {
    byId.set(option.id, option);
  }
  for (const option of assignable) {
    byId.set(option.id, option);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Order-insensitive equality of two channel-id selections. */
export function sameChannelSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}
