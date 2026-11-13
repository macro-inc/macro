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

/** Duration each kind plays for when a transition leaves `durationMs` out.
 * Camera kinds travel further, so they take longer. */
export const TRANSITION_DEFAULT_DURATION_MS: Readonly<
  Record<SlideTransitionKind, number>
> = {
  none: 0,
  fade: 400,
  fadeThroughBlack: 600,
  dissolve: 500,
  push: 500,
  cover: 500,
  uncover: 500,
  wipe: 500,
  split: 500,
  iris: 600,
  zoom: 500,
  flip: 700,
  cube: 700,
  pan: 900,
  fly: 1200,
  overview: 1200,
  path: 1200,
};
export const TRANSITION_DEFAULT_EASING: TransitionEasing = 'easeInOut';
export const TRANSITION_DEFAULT_DIRECTION: TransitionDirection = 'left';

const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  values.some((known) => known === value);

/** A known kind, with optional fields that are absent or in range. Extra keys
 * are tolerated so a newer client's additions do not hide the transition. */
export function validSlideTransition(value: unknown): value is SlideTransition {
  if (!value || typeof value !== 'object') return false;

  const transition: Record<string, unknown> = { ...value };
  const { kind, durationMs, easing, direction } = transition;
  if (!oneOf(SLIDE_TRANSITION_KINDS, kind)) return false;

  const validDuration =
    durationMs === undefined ||
    (typeof durationMs === 'number' &&
      Number.isFinite(durationMs) &&
      durationMs >= TRANSITION_DURATION_MIN_MS &&
      durationMs <= TRANSITION_DURATION_MAX_MS);
  if (!validDuration) return false;

  if (easing !== undefined && !oneOf(TRANSITION_EASINGS, easing)) return false;

  return direction === undefined || oneOf(TRANSITION_DIRECTIONS, direction);
}

/** The slide's own transition wins whole, then the deck default, then a cut.
 * Fields the winner leaves out take its kind's defaults; they are not merged
 * from the deck default. */
export function resolveSlideTransition(
  slide?: SlideTransition,
  deckDefault?: SlideTransition
): ResolvedSlideTransition {
  const transition = slide ?? deckDefault ?? { kind: 'none' };

  return {
    kind: transition.kind,
    durationMs:
      transition.durationMs ?? TRANSITION_DEFAULT_DURATION_MS[transition.kind],
    easing: transition.easing ?? TRANSITION_DEFAULT_EASING,
    direction: transition.direction ?? TRANSITION_DEFAULT_DIRECTION,
  };
}
