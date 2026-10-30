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

export const iconControlSizes = {
  xs: 'size-6 min-h-0 shrink-0 aspect-square p-0 text-xs',
  sm: 'size-7 min-h-0 shrink-0 aspect-square p-0 text-sm',
  md: 'size-8 min-h-0 shrink-0 aspect-square p-0 text-sm',
  lg: 'size-10 min-h-0 shrink-0 aspect-square p-0 text-base',
  xl: 'size-12 min-h-0 shrink-0 aspect-square p-0 text-xl',
} as const;
