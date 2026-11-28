import type { ChannelEntity } from '@entity';
import {
  type ChannelIdWindow,
  type ChannelWindowSlice,
  channelIdWindow,
  EMPTY_CHANNEL_WINDOW,
} from '@queries/channel/window';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelSectionKey } from '../../../../types';
import type { MobileRowsOnScreen } from '../../../ChannelsMobileView';

/** Rows looked up beyond each end of the screen, as the phone list mounts them. */
const MOBILE_SECTION_OVERSCAN = 6;

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
 * The selected section's members to look up by ID, as on desktop: the rows on
 * screen and a few beyond that no live list holds, and, once the end of the
 * list is on screen, the next members discovery asks for. Rows elsewhere
 * show the directory's records; nothing past the screen is looked up.
 */
export function mobileSectionMemberWindow(options: {
  label: ChannelLabel | undefined;
  rows: MobileRowsOnScreen | undefined;
  /** IDs a live list (recents, unread) holds. */
  isLoaded: (id: string) => boolean;
  /** The next members discovery asks for, empty while the directory may still bring them. */
  discover: readonly string[];
}): ChannelIdWindow {
  const { label, rows } = options;
  if (!label || !rows) return EMPTY_CHANNEL_WINDOW;
  const end = rows.end + 1 + MOBILE_SECTION_OVERSCAN;
  const slices: ChannelWindowSlice[] = [
    {
      key: `rows:${label.id}`,
      ids: rows.ids,
      range: { start: Math.max(0, rows.start - MOBILE_SECTION_OVERSCAN), end },
      isLoaded: options.isLoaded,
    },
  ];
  if (end >= rows.ids.length && options.discover.length > 0) {
    slices.push({ key: `unknown:${label.id}`, ids: options.discover });
  }
  return channelIdWindow(slices);
}
