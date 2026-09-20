import { DEFAULT_ASIDE_LAYOUT } from '@app/components/view-shell/view-shell-layout';
import type { ChannelListSort, ChannelsGroup } from './types';

export const CHANNELS_DEFAULT_RAIL_WIDTH = DEFAULT_ASIDE_LAYOUT.width;
export const CHANNELS_MIN_RAIL_WIDTH = DEFAULT_ASIDE_LAYOUT.min;
export const CHANNELS_MAX_RAIL_WIDTH = DEFAULT_ASIDE_LAYOUT.max;

export const CHANNELS_DEFAULT_SORT_BY = {
  channels: 'updated_at',
  direct_messages: 'updated_at',
} satisfies Record<ChannelsGroup, ChannelListSort>;

export function clampChannelsRailWidth(width: number): number {
  if (!Number.isFinite(width)) return CHANNELS_DEFAULT_RAIL_WIDTH;

  return Math.min(
    CHANNELS_MAX_RAIL_WIDTH,
    Math.max(CHANNELS_MIN_RAIL_WIDTH, width)
  );
}
