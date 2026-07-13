/**
 * Shared design tokens for dynamic-ui widgets.
 *
 * Use these instead of hand-picking Tailwind classes so every widget matches the
 * app theme. The palette is "ink" (foreground) / "edge" (borders) / "surface"
 * (backgrounds) / "accent", per the existing component library.
 */

/** Foreground text colours. */
export const TEXT = {
  primary: 'text-ink',
  secondary: 'text-ink-muted',
  tertiary: 'text-ink-extra-muted',
  accent: 'text-accent',
} as const;

/** Borders + surfaces. */
export const SURFACE = {
  panel: 'bg-surface',
  border: 'border-edge',
  borderMuted: 'border-edge-muted',
} as const;
