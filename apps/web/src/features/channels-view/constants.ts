export const CHANNELS_NARROW_RAIL_WIDTH = 64;
export const CHANNELS_DEFAULT_RAIL_WIDTH = 360;
export const CHANNELS_MIN_RAIL_WIDTH = 224;
export const CHANNELS_MAX_RAIL_WIDTH = 420;

export function clampChannelsRailWidth(width: number): number {
  if (!Number.isFinite(width)) return CHANNELS_DEFAULT_RAIL_WIDTH;

  return Math.min(
    CHANNELS_MAX_RAIL_WIDTH,
    Math.max(CHANNELS_MIN_RAIL_WIDTH, width)
  );
}
