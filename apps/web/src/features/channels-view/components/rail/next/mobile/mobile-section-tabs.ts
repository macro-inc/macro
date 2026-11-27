import type { ChannelEntity } from '@entity';
import {
  type ChannelIdWindow,
  channelIdWindow,
  EMPTY_CHANNEL_WINDOW,
} from '@queries/channel/window';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelSectionKey } from '../../../../types';

export type MobileSectionTab = 'all' | 'direct_messages' | `label:${string}`;

export function mobileSectionTabKeys(
  labels: readonly ChannelLabel[],
  order: readonly ChannelSectionKey[]
): MobileSectionTab[] {
  const keys = labels.map((label) => `label:${label.id}` as const);
  const saved = order.filter((key): key is `label:${string}` =>
    keys.some((labelKey) => labelKey === key)
  );
  return ['all', 'direct_messages', ...new Set([...saved, ...keys])];
}

/** Deleted sections fall back immediately without retaining an invalid selection. */
export function resolveMobileSectionTab(
  selected: MobileSectionTab,
  keys: readonly MobileSectionTab[]
): MobileSectionTab {
  return keys.includes(selected) ? selected : 'all';
}

export function channelsForMobileSection(options: {
  tab: MobileSectionTab;
  channels: readonly ChannelEntity[];
  labels: readonly ChannelLabel[];
}): ChannelEntity[] {
  if (options.tab === 'all') {
    // The list removes pins except rows with incoming-call actions.
    return options.channels.filter(
      (channel) => channel.isParticipant !== false
    );
  }
  if (options.tab === 'direct_messages')
    return options.channels.filter(
      (channel) =>
        channel.channelType === 'direct_message' &&
        channel.isParticipant !== false
    );
  const label = options.labels.find(
    (label) => `label:${label.id}` === options.tab
  );
  // Index once: scanning a reactive member array for every row multiplies
  // both the work and Solid subscriptions for large name-matched sections.
  const memberIds = new Set(label?.channelIds);
  return options.channels.filter((channel) => memberIds.has(channel.id));
}

/**
 * The selected section's members to look up by ID: those no loaded list holds,
 * at most a window's worth. Phone rows show the directory's records, so once
 * it has filled only members it lacks are fetched.
 */
export function mobileSectionMemberWindow(
  label: ChannelLabel | undefined,
  loaded: readonly (readonly ChannelEntity[])[]
): ChannelIdWindow {
  if (!label) return EMPTY_CHANNEL_WINDOW;
  const held = new Set(loaded.flat().map((channel) => channel.id));
  return channelIdWindow([
    {
      key: `label:${label.id}`,
      ids: label.channelIds.filter((id) => !held.has(id)),
    },
  ]);
}
