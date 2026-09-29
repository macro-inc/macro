/** Shared size classes for controls with text and optional icons. */
export const CONTROL_SIZE_VARIANTS = {
  sm: "h-6 gap-1 px-2 text-xs [&>svg:not([class*='size-'])]:size-3",
  md: "h-8 gap-2 px-2 text-sm [&>svg:not([class*='size-'])]:size-3.5",
  lg: "h-9 gap-2 px-3 text-base [&>svg:not([class*='size-'])]:size-[1em]",
} as const;
