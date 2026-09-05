/**
 * An action the session took, rendered as a rule with its label in the middle.
 *
 * The quiet treatment for things that happened *to* the session rather than in
 * it — a model switch, a compaction — so they read as punctuation between
 * turns instead of competing with tool cards for attention.
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export interface ActionLineProps {
  /** What happened, e.g. `Model set to opus`. */
  label: string;
  /**
   * The action did not take. Reads in the failure ink, so a refused action
   * cannot be mistaken for one that went through.
   */
  failed?: boolean;
  /**
   * Verbatim detail behind the label — a runtime's error message. Shown on
   * hover rather than inline: the line is punctuation between turns, and an
   * arbitrarily long message would make it the loudest thing in the
   * transcript.
   */
  detail?: string;
  /** Optional glyph before the label. */
  icon?: JSX.Element;
}

export function ActionLine(props: ActionLineProps) {
  return (
    <div
      class="flex w-full items-center gap-4 px-4 py-1 text-xs"
      classList={{
        'text-ink-extra-muted': !props.failed,
        'text-failure': props.failed,
      }}
    >
      <span aria-hidden="true" class="h-px flex-1 bg-edge-muted" />
      <span class="flex min-w-0 items-center gap-1.5" title={props.detail}>
        <Show when={props.icon}>
          <span aria-hidden="true" class="flex shrink-0 items-center">
            {props.icon}
          </span>
        </Show>
        <span class="min-w-0 truncate">{props.label}</span>
      </span>
      <span aria-hidden="true" class="h-px flex-1 bg-edge-muted" />
    </div>
  );
}
