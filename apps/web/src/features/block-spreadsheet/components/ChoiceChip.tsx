import type { ParentProps } from 'solid-js';
import { cellBackground, cellForeground } from './cell-colors';

/** A dropdown choice drawn in its color, as Google Sheets draws chips. */
export function ChoiceChip(props: ParentProps<{ color: string }>) {
  return (
    <span
      data-choice-chip
      class="inline-block max-w-full truncate rounded-full px-[0.6em] align-middle leading-[1.45]"
      style={{
        'background-color': cellBackground(props.color),
        color: cellForeground(undefined, props.color),
      }}
    >
      {props.children}
    </span>
  );
}
