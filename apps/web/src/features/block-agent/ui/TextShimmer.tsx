/**
 * A sweeping gradient shimmer over a piece of text while `active`, crossfading
 * back to plain text when it settles.
 *
 * Ported from opencode's `packages/ui/src/components/text-shimmer.tsx`
 * (github.com/sst/opencode, MIT © 2025 opencode). Rewritten against Macro's
 * tokens: the sweep reuses the global `magic-chip-shimmer` keyframes from
 * `index.css` (which already handles `prefers-reduced-motion`) instead of
 * opencode's CSS variable system.
 */

import { createEffect, createSignal, onCleanup } from 'solid-js';

/** How long the crossfade between shimmering and plain text runs. */
const SWAP_MS = 200;

export interface TextShimmerProps {
  text: string;
  active: boolean;
  class?: string;
}

/** Two stacked copies of the text: a plain base and a shimmering overlay. */
export function TextShimmer(props: TextShimmerProps) {
  // Keep the sweep running while the shimmer layer fades out, so deactivation
  // doesn't freeze the gradient mid-swipe.
  const [run, setRun] = createSignal(props.active);
  let timer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (props.active) {
      setRun(true);
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      setRun(false);
    }, SWAP_MS);
  });

  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  return (
    <span
      class={`inline-grid whitespace-pre align-baseline ${props.class ?? ''}`}
      aria-label={props.text}
    >
      <span
        aria-hidden="true"
        class="col-start-1 row-start-1 transition-opacity duration-200 motion-reduce:transition-none"
        classList={{ 'opacity-0': props.active }}
      >
        {props.text}
      </span>
      <span
        aria-hidden="true"
        class="col-start-1 row-start-1 transition-opacity duration-200 motion-reduce:transition-none"
        classList={{
          'opacity-0': !props.active,
          'magic-chip-shimmer': run(),
        }}
      >
        {props.text}
      </span>
    </span>
  );
}
