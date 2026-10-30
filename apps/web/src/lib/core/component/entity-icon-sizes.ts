const ICON_SIZES = {
  xs: 'w-4 h-4',
  sm: 'w-4.5 h-4.5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  fill: 'w-full h-full',
  shrinkFill: 'w-full h-full',
} as const;

export const ICON_SIZE_CLASSES = {
  xs: `${ICON_SIZES.xs} flex items-center justify-center overflow-hidden shrink-0`,
  sm: `${ICON_SIZES.sm} flex items-center justify-center overflow-hidden shrink-0`,
  md: `${ICON_SIZES.md} flex items-center justify-center overflow-hidden shrink-0`,
  lg: `${ICON_SIZES.lg} flex items-center justify-center overflow-hidden shrink-0`,
  fill: `${ICON_SIZES.fill} flex items-center justify-center overflow-hidden shrink-0`,
  shrinkFill: `${ICON_SIZES.fill} flex items-center justify-center overflow-hidden`,
} as const;
