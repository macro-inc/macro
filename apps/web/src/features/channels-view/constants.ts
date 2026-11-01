import { DEFAULT_ASIDE_LAYOUT } from '@app/components/view-shell/view-shell-layout';
import type { ChannelListSort, ChannelsSortGroup } from './types';

export const CHANNELS_DEFAULT_RAIL_WIDTH = DEFAULT_ASIDE_LAYOUT.width;
export const CHANNELS_MIN_RAIL_WIDTH = DEFAULT_ASIDE_LAYOUT.min;
export const CHANNELS_MAX_RAIL_WIDTH = DEFAULT_ASIDE_LAYOUT.max;

export const CHANNEL_SECTION_MIN_HEIGHT = 68;
export const CHANNEL_SECTION_DEFAULT_HEIGHT = 204;
export const CHANNEL_SECTION_MAX_HEIGHT = 800;

export function clampChannelSectionHeight(height: number): number {
  if (!Number.isFinite(height)) return CHANNEL_SECTION_DEFAULT_HEIGHT;
  return Math.round(
    Math.min(
      CHANNEL_SECTION_MAX_HEIGHT,
      Math.max(CHANNEL_SECTION_MIN_HEIGHT, height)
    )
  );
}

export const CHANNELS_DEFAULT_SORT_BY = {
  team_channels: 'updated_at',
  channels: 'updated_at',
  direct_messages: 'updated_at',
  threads: 'updated_at',
} satisfies Record<ChannelsSortGroup, ChannelListSort>;

export function clampChannelsRailWidth(width: number): number {
  if (!Number.isFinite(width)) return CHANNELS_DEFAULT_RAIL_WIDTH;

  return Math.min(
    CHANNELS_MAX_RAIL_WIDTH,
    Math.max(CHANNELS_MIN_RAIL_WIDTH, width)
  );
}
