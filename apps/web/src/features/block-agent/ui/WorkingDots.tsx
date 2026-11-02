/**
 * The loader leading an open agent turn: a plus of five dots - a 3×3 grid
 * without its corners - that turns to an × and back in 45° steps while its
 * dots brighten one at a time in a scattered order, on the
 * `agent-working-twirl` and `agent-working-dot` keyframes in `index.css`.
 */

import { pauseOffscreenAnimations } from '@core/util/animationVisibility';
import { For, Show } from 'solid-js';

/** One dot's brighten-and-fade; matches `agent-working-dot` in `index.css`. */
const TWINKLE_MS = 1400;

/**
 * When each cell, row by row, brightens within a cycle: the arms clockwise
 * from the top at 0, 840, 1120 and 560ms, the center at 280ms, so no path
 * reads. A corner has no dot.
 */
const TWINKLE_OFFSETS_MS = [null, 0, null, 560, 280, 840, null, 1120, null];

export function WorkingDots() {
  return (
    <span
      ref={pauseOffscreenAnimations}
      aria-hidden="true"
      class="agent-working-twirl grid size-[13px] shrink-0 grid-cols-3 gap-[2px] text-ink-muted"
    >
      <For each={TWINKLE_OFFSETS_MS}>
        {(offset) => (
          <Show when={offset !== null} fallback={<span />}>
            <span
              class="agent-working-dot size-[3px] rounded-full bg-current"
              // Negative delays start each dot mid-cycle, so none wait dim on mount.
              style={{ 'animation-delay': `${(offset ?? 0) - TWINKLE_MS}ms` }}
            />
          </Show>
        )}
      </For>
    </span>
  );
}
