/**
 * The pane's three layouts and the moves between them.
 *
 * `split` shows the host (a session or a pull request) and the changes side
 * by side; `closed` hands the width back to the host; `full` spotlights the
 * review.
 */

export const DIFF_STYLES = ['unified', 'split'] as const;
export type DiffStyle = (typeof DIFF_STYLES)[number];

export const PANE_LAYOUTS = ['closed', 'split', 'full'] as const;
export type PaneLayout = (typeof PANE_LAYOUTS)[number];

/** Share of the width the changes pane takes when it first opens. */
export const DEFAULT_CHANGES_SHARE = 58;
export const MIN_CHANGES_SHARE = 22;
export const MAX_CHANGES_SHARE = 74;

/** Minimum room for the conversation and Changes pane side by side. */
export const CHANGES_NARROW_WIDTH = 720;

export function isChangesVisible(layout: PaneLayout): boolean {
  return layout !== 'closed';
}

export function isHostVisible(layout: PaneLayout): boolean {
  return layout !== 'full';
}

/** The header toggle: open the split, or close the pane. */
export function toggleChanges(layout: PaneLayout): PaneLayout {
  return layout === 'closed' ? 'split' : 'closed';
}

/** The pane's spotlight button: take the full width, or come back. */
export function toggleSpotlight(layout: PaneLayout): PaneLayout {
  return layout === 'full' ? 'split' : 'full';
}

/** Anything that needs the pane on screen goes through this first. */
export function ensureChangesVisible(layout: PaneLayout): PaneLayout {
  return layout === 'closed' ? 'split' : layout;
}

export function clampChangesShare(share: number): number {
  if (!Number.isFinite(share)) return DEFAULT_CHANGES_SHARE;
  return Math.min(MAX_CHANGES_SHARE, Math.max(MIN_CHANGES_SHARE, share));
}
