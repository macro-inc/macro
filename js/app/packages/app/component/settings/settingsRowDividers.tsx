// Shared styling for the subtle, inset row dividers used across settings panels
// (matches the Account panel: a 1px `ink-muted/5` line inset by the row's `px-6`
// padding, so it doesn't run edge-to-edge).
//
// NOTE: these must be written as complete literal class strings so Tailwind's
// scanner picks them up — don't build them by concatenating a prefix onto a base.
// This file is intentionally `.tsx` (despite having no JSX) because Tailwind's
// `@source '../**/*.tsx'` glob in app/index.css only scans `.tsx` files; a `.ts`
// file here would be skipped and these classes would never be generated.

/**
 * Apply to a list container whose direct children are full-width rows with
 * `px-6` horizontal padding. Draws the divider under every row except the last.
 */
export const SETTINGS_ROW_DIVIDERS =
  "[&>*:not(:last-child)]:relative [&>*:not(:last-child)]:after:pointer-events-none [&>*:not(:last-child)]:after:absolute [&>*:not(:last-child)]:after:inset-x-6 [&>*:not(:last-child)]:after:bottom-0 [&>*:not(:last-child)]:after:h-px [&>*:not(:last-child)]:after:bg-ink-muted/5 [&>*:not(:last-child)]:after:content-['']";

/**
 * Row-level variant for lists that render rows individually (e.g. virtualized),
 * where a container `[&>*]` selector can't reach them. Put `relative` on the row
 * and gate this on "not the last row".
 */
export const SETTINGS_ROW_DIVIDER =
  "after:pointer-events-none after:absolute after:inset-x-6 after:bottom-0 after:h-px after:bg-ink-muted/5 after:content-['']";
