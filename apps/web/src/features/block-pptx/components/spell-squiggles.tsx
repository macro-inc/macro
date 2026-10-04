/**
 * Red wavy underlines under misspelled words on the slide being edited
 * (PowerPoint shows them in Normal view only, never in a slide show).
 */

import { For } from 'solid-js';
import { wavyPath } from '../core/spelling-scan';
import type { Squiggle } from '../primitives/create-spell-check';

export function SpellSquiggles(props: {
  squiggles: Squiggle[];
  /** Slide size in points. */
  width: number;
  height: number;
  /** Points per CSS pixel. */
  unit: number;
}) {
  return (
    <svg
      class="pointer-events-none absolute inset-0 size-full overflow-visible text-failure"
      viewBox={`0 0 ${props.width} ${props.height}`}
      aria-hidden="true"
      data-testid="pptx-spell-squiggles"
    >
      <For each={props.squiggles}>
        {(s) => (
          <For each={s.underlines}>
            {([from, to]) => (
              <path
                d={wavyPath(from, to, props.unit * 3)}
                fill="none"
                stroke="currentColor"
                stroke-width={props.unit * 1.1}
                stroke-linejoin="round"
                data-testid="pptx-squiggle"
                data-word={s.word}
              />
            )}
          </For>
        )}
      </For>
    </svg>
  );
}
