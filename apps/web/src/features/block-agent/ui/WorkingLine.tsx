/**
 * The tail of an open turn that has produced nothing to read yet.
 *
 * A sibling of `Thought`, deliberately shaped differently. A thought row leads
 * with a caret because there is text behind it; this row has nothing to
 * expand, so the caret gives way to a dot that breathes on the shimmer's own
 * period, and the row is not a control at all. The leading slot keeps the
 * caret's width so the label does not shift sideways once reasoning arrives
 * and the row becomes a `Thought`.
 */

import { createSignal, onCleanup } from 'solid-js';
import { TextShimmer } from './TextShimmer';
import { createVerbDraw, WORKING_LABEL } from './working-verbs';

/**
 * How long a word holds. Faster reads as thrashing rather than work. The first
 * word holds for a full interval too, so the short turns that make up most of
 * a session never show a verb at all.
 */
const HOLD_MS = 4000;

/** How long the crossfade between words runs. */
const SWAP_MS = 180;

export function WorkingLine() {
  const [verb, setVerb] = createSignal(WORKING_LABEL);
  const [swapping, setSwapping] = createSignal(false);

  const drawVerb = createVerbDraw();
  let swapTimer: ReturnType<typeof setTimeout> | undefined;

  const rotation = setInterval(() => {
    setSwapping(true);
    swapTimer = setTimeout(() => {
      setVerb(drawVerb());
      setSwapping(false);
    }, SWAP_MS);
  }, HOLD_MS);

  onCleanup(() => {
    clearInterval(rotation);
    if (swapTimer !== undefined) clearTimeout(swapTimer);
  });

  return (
    <div class="flex min-h-7 items-center gap-1 py-1 text-xs leading-5 text-ink-extra-muted">
      <span
        aria-hidden="true"
        class="flex size-4 shrink-0 items-center justify-center"
      >
        <span class="agent-working-dot size-[5px] rounded-full bg-current" />
      </span>
      {/* The visible word rotates; the label a screen reader hears does not.
          Narrating a synonym every few seconds is noise, and the one fact
          worth announcing is that the turn is still open. */}
      <TextShimmer
        text={verb()}
        label={WORKING_LABEL}
        active
        class={`transition-opacity duration-200 motion-reduce:transition-none ${
          swapping() ? 'opacity-0' : ''
        }`}
      />
    </div>
  );
}
