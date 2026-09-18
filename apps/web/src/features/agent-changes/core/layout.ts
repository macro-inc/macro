/**
 * The pane's three layouts and the moves between them.
 *
 * `split` shows the session and the changes side by side; `agent-only` hands
 * the width back to the transcript; `changes-only` spotlights the review.
 */

export type DiffStyle = 'unified' | 'split';

export type PaneLayout = 'split' | 'agent-only' | 'changes-only';

/** Share of the width the changes pane takes when it first opens. */
export const DEFAULT_CHANGES_SHARE = 58;
export const MIN_CHANGES_SHARE = 22;
export const MAX_CHANGES_SHARE = 74;

export function isChangesVisible(layout: PaneLayout): boolean {
  return layout !== 'agent-only';
}

export function isSessionVisible(layout: PaneLayout): boolean {
  return layout !== 'changes-only';
}

/** The session header toggle: open the split, or close the pane. */
export function toggleChanges(layout: PaneLayout): PaneLayout {
  return layout === 'agent-only' ? 'split' : 'agent-only';
}

/** The pane's spotlight button: take the full width, or come back. */
export function toggleSpotlight(layout: PaneLayout): PaneLayout {
  return layout === 'changes-only' ? 'split' : 'changes-only';
}

/** Anything that needs the pane on screen goes through this first. */
export function ensureChangesVisible(layout: PaneLayout): PaneLayout {
  return layout === 'agent-only' ? 'split' : layout;
}

export function clampChangesShare(share: number): number {
  if (!Number.isFinite(share)) return DEFAULT_CHANGES_SHARE;
  return Math.min(MAX_CHANGES_SHARE, Math.max(MIN_CHANGES_SHARE, share));
}
