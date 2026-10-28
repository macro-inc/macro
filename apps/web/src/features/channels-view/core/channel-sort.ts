import {
  compareDateAsc,
  compareDateDesc,
  type DateValue,
} from '@core/util/date';
import type { ChannelEntity } from '@entity';
import { match } from 'ts-pattern';
import type { ChannelListSort } from '../types';

/**
 * When a channel last moved in the `updated_at` sort. An unread channel holds
 * the place it took when it first went unread: the rail shows only a dot for
 * unread, so a later message moving it up would look like it jumped for no
 * reason. It takes its latest place again once it is read.
 */
function activitySortDate(
  channel: ChannelEntity
): DateValue | null | undefined {
  const oldestUnseen = channel.unreadNotifications
    ?.filter((notification) => notification.state === 'unseen')
    .map((notification) => notification.createdAt)
    .sort(compareDateAsc)[0];
  if (oldestUnseen === undefined) return channel.updatedAt;
  if (!channel.updatedAt) return oldestUnseen;
  return compareDateAsc(oldestUnseen, channel.updatedAt) < 0
    ? oldestUnseen
    : channel.updatedAt;
}

export function sortChannels(
  channels: readonly ChannelEntity[],
  sort: ChannelListSort
): ChannelEntity[] {
  const sortDate = (channel: ChannelEntity) =>
    match(sort)
      .with('created_at', () => channel.createdAt)
      .with('viewed_at', () => channel.viewedAt)
      .with('updated_at', () => activitySortDate(channel))
      .exhaustive();

  return channels
    .slice()
    .sort((left, right) => compareDateDesc(sortDate(left), sortDate(right)));
}
