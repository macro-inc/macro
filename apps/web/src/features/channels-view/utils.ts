import type { DateValue } from '@core/util/date';
import type { ChannelEntity } from '@entity';
import type { ChannelsGroup, ChannelsTab } from './types';

export function isDirectMessage(channel: ChannelEntity) {
  return channel.channelType === 'direct_message';
}

export function channelGroup(channel: ChannelEntity): ChannelsGroup {
  return isDirectMessage(channel) ? 'direct_messages' : 'channels';
}

export function channelHasMessages(channel: ChannelEntity) {
  return Boolean(channel.latestRootMessage);
}

export function channelMentionsUser(
  channel: ChannelEntity,
  userId: string | undefined
) {
  if (!userId) return false;

  const normalizedUserId = userId.toLocaleLowerCase();
  return Boolean(
    channel.latestRootMessage?.mentions.some(
      (mention) => mention.toLocaleLowerCase() === normalizedUserId
    )
  );
}

export function channelInitials(name: string) {
  const words = name.replace(/^#+/, '').trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return '?';

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toLocaleUpperCase();
}

export function formatDetailedTimestamp(timestamp: DateValue) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * The tab to render for a stored choice. Threads falls back to All while its
 * flag is off or still loading, without rewriting the stored choice.
 */
export function activeChannelsTab(
  tab: ChannelsTab,
  threadsEnabled: boolean
): ChannelsTab {
  return tab === 'threads' && !threadsEnabled ? 'browse' : tab;
}
