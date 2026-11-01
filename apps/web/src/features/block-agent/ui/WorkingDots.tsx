/**
 * The loader leading an open agent turn: the dots of a 3×3 grid brighten one
 * at a time in a scattered order and fade out completely between turns, on
 * the `agent-working-dot` keyframes in `index.css`, so at any moment a few
 * of the nine are gone.
 */

import { For } from 'solid-js';

/** One dot's brighten-and-fade; matches `agent-working-dot` in `index.css`. */
const TWINKLE_MS = 1600;

/** When each dot, row by row, brightens within a cycle; scattered so no path reads. */
const TWINKLE_OFFSETS_MS = [0, 700, 300, 1100, 500, 900, 200, 1300, 600];

export function WorkingDots() {
  return (
    <span
      aria-hidden="true"
      class="grid size-[13px] shrink-0 grid-cols-3 gap-[2px] text-ink-muted"
    >
      <For each={TWINKLE_OFFSETS_MS}>
        {(offset) => (
          <span
            class="agent-working-dot size-[3px] rounded-full bg-current"
            // Negative delays start each dot mid-cycle, so none wait blank on mount.
            style={{ 'animation-delay': `${offset - TWINKLE_MS}ms` }}
          />
        )}
      </For>
    </span>
  );
}
