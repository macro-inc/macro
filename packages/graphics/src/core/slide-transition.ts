/**
 * How the presentation moves onto an artifact (slide). Like Google Slides and
 * PowerPoint, a slide's transition plays when it is entered. A slide without
 * one uses the canvas's deck default, and a canvas without a default cuts.
 *
 * Classic kinds composite the outgoing and incoming slides in screen space.
 * Canvas kinds move a camera across the canvas itself between the slides' real
 * positions on the 2D plane.
 */
export const CLASSIC_TRANSITION_KINDS = [
  'none',
  'fade',
  'fadeThroughBlack',
  'dissolve',
  'push',
  'cover',
  'uncover',
  'wipe',
  'split',
  'iris',
  'zoom',
  'flip',
  'cube',
] as const;
export const CANVAS_TRANSITION_KINDS = [
  /** Straight camera pan at a constant zoom between the slides' positions. */
  'pan',
  /** Smooth zoom-and-pan arc (van Wijk–Nuij): pulls back as far as the
   * distance needs, then settles on the next slide. */
  'fly',
  /** Zooms out to the whole canvas overview, then into the next slide. */
  'overview',
  /** Follows a connector or arrow between the two slides, when one exists;
   * otherwise behaves like fly. */
  'path',
] as const;
export const SLIDE_TRANSITION_KINDS = [
  ...CLASSIC_TRANSITION_KINDS,
  ...CANVAS_TRANSITION_KINDS,
] as const;
export type SlideTransitionKind = (typeof SLIDE_TRANSITION_KINDS)[number];

export const TRANSITION_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

export const TRANSITION_EASINGS = [
  'linear',
  'ease',
  'easeIn',
  'easeOut',
  'easeInOut',
] as const;
export type TransitionEasing = (typeof TRANSITION_EASINGS)[number];

/** Kinds whose `direction` changes how they play. */
export const DIRECTIONAL_TRANSITION_KINDS: ReadonlySet<SlideTransitionKind> =
  new Set(['push', 'cover', 'uncover', 'wipe', 'split', 'flip', 'cube']);

export const TRANSITION_DURATION_MIN_MS = 100;
export const TRANSITION_DURATION_MAX_MS = 5000;

/** Omitted fields take the kind's defaults (see `resolveSlideTransition`). */
export type SlideTransition = Readonly<{
  kind: SlideTransitionKind;
  durationMs?: number;
  easing?: TransitionEasing;
  direction?: TransitionDirection;
}>;

export type ResolvedSlideTransition = Readonly<{
  kind: SlideTransitionKind;
  durationMs: number;
  easing: TransitionEasing;
  direction: TransitionDirection;
}>;
