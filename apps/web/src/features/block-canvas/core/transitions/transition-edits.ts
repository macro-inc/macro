import type { SlideTransition, SlideTransitionKind } from '@macro-inc/graphics';

/**
 * What a slide plays as stored values, not resolved ones: its own transition,
 * else the deck default, else a cut. Edits start here so a slide that inherits
 * keeps every field the deck default set, and nothing resolved (a cut's 0 ms
 * duration) is ever written back.
 */
export function storedTransition(
  own: SlideTransition | undefined,
  deckDefault: SlideTransition | undefined
): SlideTransition {
  return own ?? deckDefault ?? { kind: 'none' };
}

/** The slide's transition with some fields changed. */
export function editedTransition(
  own: SlideTransition | undefined,
  deckDefault: SlideTransition | undefined,
  patch: Partial<SlideTransition>
): SlideTransition {
  return { ...storedTransition(own, deckDefault), ...patch };
}

/** The slide's transition switched to another kind: the new kind starts from
 * its own default duration; easing and direction carry over. */
export function transitionOfKind(
  own: SlideTransition | undefined,
  deckDefault: SlideTransition | undefined,
  kind: SlideTransitionKind
): SlideTransition {
  const { durationMs: _duration, ...kept } = storedTransition(own, deckDefault);
  return { ...kept, kind };
}

/** What "Apply to all" makes the deck default: what this slide plays, or no
 * default at all when nothing is set anywhere. */
export function deckDefaultForAll(
  own: SlideTransition | undefined,
  deckDefault: SlideTransition | undefined
): SlideTransition | null {
  return own ?? deckDefault ?? null;
}
