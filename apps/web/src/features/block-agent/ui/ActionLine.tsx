/**
 * An action the session took, rendered as a rule with its label in the middle.
 *
 * The quiet treatment for things that happened *to* the session rather than in
 * it — a model switch, a compaction — so they read as punctuation between
 * turns instead of competing with tool cards for attention.
 */

import CaretRight from '@phosphor/caret-right.svg';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';

export interface ActionLineProps {
  /** What happened, e.g. `Model set to opus`. */
  label: string;
  /**
   * The action did not take. Reads in the failure ink, so a refused action
   * cannot be mistaken for one that went through.
   */
  failed?: boolean;
  /**
   * Verbatim detail behind the label — context or a runtime's error. Collapsed
   * behind the label rather than inline: the line is punctuation between
   * turns, and an arbitrarily long message would make it the loudest thing in
   * the transcript. Clicking the label expands it.
   */
  detail?: string;
  /** Optional glyph before the label. */
  icon?: JSX.Element;
}

export function ActionLine(props: ActionLineProps) {
  const [expanded, setExpanded] = createSignal(false);

  const label = () => (
    <>
      <Show when={props.icon}>
        <span aria-hidden="true" class="flex shrink-0 items-center">
          {props.icon}
        </span>
      </Show>
      <span class="min-w-0" classList={{ truncate: !expanded() }}>
        {props.label}
      </span>
    </>
  );

  return (
    <div
      class="w-full px-4 py-1 text-xs"
      classList={{
        'text-ink-extra-muted': !props.failed,
        'text-failure': props.failed,
      }}
    >
      <div class="flex w-full items-center gap-4">
        <span aria-hidden="true" class="h-px flex-1 bg-edge-muted" />
        <Show
          when={props.detail}
          fallback={
            <span class="flex min-w-0 items-center gap-1.5">{label()}</span>
          }
        >
          <button
            type="button"
            aria-expanded={expanded()}
            class="flex min-w-0 items-center gap-1.5 text-left hover:opacity-80"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {label()}
            <CaretRight
              aria-hidden="true"
              class="size-3 shrink-0"
              classList={{ 'rotate-90': expanded() }}
            />
          </button>
        </Show>
        <span aria-hidden="true" class="h-px flex-1 bg-edge-muted" />
      </div>
      <Show when={expanded() && props.detail}>
        {(detail) => (
          <pre
            class="mt-1.5 max-h-64 overflow-auto rounded-md px-3 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap wrap-break-word select-text"
            classList={{
              'bg-failure-bg': props.failed,
              'bg-hover': !props.failed,
            }}
          >
            {detail()}
          </pre>
        )}
      </Show>
    </div>
  );
}
