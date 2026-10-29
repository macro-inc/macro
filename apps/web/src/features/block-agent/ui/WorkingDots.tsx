/**
 * The loader leading an open agent turn: a run of dots chasing clockwise
 * around the edge of a 3×3 grid, on the `agent-working-dot` keyframes in
 * `index.css`. The centre stays dark, so the run reads as a loop.
 */

import { For } from 'solid-js';

/** One lap around the grid's edge. */
const LAP_MS = 800;
const EDGE_CELLS = 8;

/** Each cell's place on the lap, row by row; the centre has none. */
const LAP_POSITIONS = [0, 1, 2, 7, null, 3, 6, 5, 4] as const;

export function WorkingDots() {
  return (
    <span
      aria-hidden="true"
      class="grid size-[13px] shrink-0 grid-cols-3 gap-[2px] text-ink-muted"
    >
      <For each={LAP_POSITIONS}>
        {(position) => (
          <span
            class="size-[3px] rounded-full bg-current"
            classList={{
              'agent-working-dot': position !== null,
              'opacity-0': position === null,
            }}
            // A later place starts further back, so the lit run moves clockwise.
            style={
              position === null
                ? undefined
                : {
                    'animation-delay': `${((position - EDGE_CELLS) * LAP_MS) / EDGE_CELLS}ms`,
                  }
            }
          />
        )}
      </For>
    </span>
  );
}
