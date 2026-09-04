import type { BreakpointThresholds } from '@app/util/create-size-breakpoints';

export const DEFAULT_VIEW_SHELL_BREAKPOINT_THRESHOLDS = {
  narrow: 720,
} as const satisfies BreakpointThresholds;

export type AsideLayout = {
  width: number;
  min: number;
  max: number;
  /**
   * Whether automatic container resizing should preserve `width`.
   * Set to false with a main `preferredWidth` to let the aside yield first.
   */
  preserveDuringResize?: boolean;
};

export const DEFAULT_ASIDE_LAYOUT: AsideLayout = {
  width: 288,
  min: 224,
  max: 360,
};

export type MainLayout = {
  width?: number;
  min: number;
  max?: number;
  /**
   * Soft width protected while a yielding aside shrinks toward its minimum.
   * Unlike `min`, this does not prevent Main from shrinking when space runs out.
   */
  preferredWidth?: number;
};

export const DEFAULT_MAIN_LAYOUT: MainLayout = {
  min: 320,
};

export type DetailNarrowBehavior = 'overlay' | 'replace' | 'hide';

export type DetailLayout = {
  width: number;
  /** Initial inline panel width. Use `auto` to fill the space left by siblings. */
  initialWidth?: number | 'auto';
  min: number;
  max: number;
  whenNarrow: DetailNarrowBehavior;
};

export const DEFAULT_DETAIL_LAYOUT: DetailLayout = {
  width: 420,
  min: 320,
  max: 640,
  whenNarrow: 'overlay',
};

/**
 * Where the shell puts the detail region right now.
 *
 * - `inline` — docked beside Content, reserving width in the resize solver.
 * - `overlay` — floats above Content.
 * - `replace` — takes over the Content area.
 * - `hidden` — closed, or suppressed at the layout breakpoint.
 */
export type DetailPlacement = 'inline' | 'overlay' | 'replace' | 'hidden';

export type AsideMode = 'docked' | 'collapsed';

export const DEFAULT_LAYOUT_BREAKPOINT = 'narrow';
