import type { ChannelListSort, ChannelsGroup } from './types';

export const CHANNELS_NARROW_RAIL_WIDTH = 64;
export const CHANNELS_DEFAULT_RAIL_WIDTH = 256;
export const CHANNELS_MIN_RAIL_WIDTH = 224;
export const CHANNELS_MAX_RAIL_WIDTH = 420;

export const CHANNELS_DEFAULT_SORT_BY = {
  channels: 'updated_at',
  direct_messages: 'updated_at',
} satisfies Record<ChannelsGroup, ChannelListSort>;

export const CHANNELS_DEFAULT_SLIM_GROUPS = {
  channels: true,
  direct_messages: true,
} satisfies Record<ChannelsGroup, boolean>;

export function clampChannelsRailWidth(width: number): number {
  if (!Number.isFinite(width)) return CHANNELS_DEFAULT_RAIL_WIDTH;

  return Math.min(
    CHANNELS_MAX_RAIL_WIDTH,
    Math.max(CHANNELS_MIN_RAIL_WIDTH, width)
  );
}
