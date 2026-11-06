import type { ChannelListSort, ChannelsSortGroup } from './types';

export const CHANNEL_SECTION_ROW_HEIGHT = 34;
export const CHANNEL_SECTION_MIN_ITEMS = 2;
export const CHANNEL_SECTION_MIN_HEIGHT =
  CHANNEL_SECTION_ROW_HEIGHT * CHANNEL_SECTION_MIN_ITEMS;
export const CHANNEL_SECTION_MAX_HEIGHT = 800;

export function clampChannelSectionHeight(height: number): number {
  if (!Number.isFinite(height)) return CHANNEL_SECTION_MAX_HEIGHT;
  return Math.round(Math.max(CHANNEL_SECTION_MIN_HEIGHT, height));
}

export const CHANNELS_DEFAULT_SORT_BY = {
  team_channels: 'updated_at',
  channels: 'updated_at',
  direct_messages: 'updated_at',
  threads: 'updated_at',
} satisfies Record<ChannelsSortGroup, ChannelListSort>;
