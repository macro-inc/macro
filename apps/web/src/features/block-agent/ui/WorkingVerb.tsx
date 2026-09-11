/**
 * The rotating word an open turn shows while nothing more specific is on
 * screen. Shared by the transcript's working row and the channel chip.
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

export function WorkingVerb(props: { class?: string }) {
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
    <TextShimmer
      text={verb()}
      label={WORKING_LABEL}
      active
      class={`transition-opacity duration-200 motion-reduce:transition-none ${
        swapping() ? 'opacity-0' : ''
      }${props.class ? ` ${props.class}` : ''}`}
    />
  );
}
