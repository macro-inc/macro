/** Shared frame and content sizes let tab labels fill their clickable surface. */
export const labeledControlFrames = {
  xs: 'min-h-6',
  sm: 'min-h-7',
  md: 'min-h-8',
  lg: 'min-h-10',
  xl: 'min-h-12',
} as const;

export type LabeledControlSize = keyof typeof labeledControlFrames;

export const labeledControlContents = {
  xs: 'px-2 py-0.5 text-xs',
  sm: 'px-2 py-0.5 text-sm',
  md: 'px-2 py-0.5 text-sm',
  lg: 'px-4 py-1 text-base',
  xl: 'px-4 py-2 text-xl',
} as const satisfies Record<LabeledControlSize, string>;

/** Button applies the same frame and content sizing to one element. */
export const labeledControlSizes = {
  xs: `${labeledControlFrames.xs} ${labeledControlContents.xs}`,
  sm: `${labeledControlFrames.sm} ${labeledControlContents.sm}`,
  md: `${labeledControlFrames.md} ${labeledControlContents.md}`,
  lg: `${labeledControlFrames.lg} ${labeledControlContents.lg}`,
  xl: `${labeledControlFrames.xl} ${labeledControlContents.xl}`,
} as const;

export const buttonControlFrames = {
  ...labeledControlFrames,
  'icon-xs': 'h-6',
  'icon-sm': 'h-7',
  'icon-md': 'h-8',
  'icon-lg': 'h-10',
  'icon-xl': 'h-12',
} as const;
export const iconControlSizes = {
  xs: `${buttonControlFrames['icon-xs']} w-6 min-h-0 shrink-0 aspect-square p-0 text-xs`,
  sm: `${buttonControlFrames['icon-sm']} w-7 min-h-0 shrink-0 aspect-square p-0 text-sm`,
  md: `${buttonControlFrames['icon-md']} w-8 min-h-0 shrink-0 aspect-square p-0 text-sm`,
  lg: `${buttonControlFrames['icon-lg']} w-10 min-h-0 shrink-0 aspect-square p-0 text-base`,
  xl: `${buttonControlFrames['icon-xl']} w-12 min-h-0 shrink-0 aspect-square p-0 text-xl`,
} as const;
