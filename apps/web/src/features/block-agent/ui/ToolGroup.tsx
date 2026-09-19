/**
 * A run of consecutive tool calls folded to one row: how many, and — while
 * closed — the latest one in a quiet line beneath, so a reader following a
 * long stretch of tool use sees what the agent is on without a card per call.
 *
 * Shaped like `Thought` rather than `ToolCard`: a bare caret row, no surface,
 * because the cards themselves appear once it opens.
 */

import CaretRight from '@phosphor/caret-right.svg';
import { createSignal, type JSX, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

export interface ToolGroupProps {
  count: number;
  /** A call in the run is still in flight: reads "Calling" and shimmers. */
  active: boolean;
  /** The most recent call: its label and, when it has one, what it touched. */
  latest: { label: string; detail?: string };
  defaultOpen?: boolean;
  /** The calls themselves, shown in place of the latest line once open. */
  children: JSX.Element;
}

export function ToolGroup(props: ToolGroupProps) {
  const [expanded, setExpanded] = createSignal(props.defaultOpen ?? false);
  const title = () =>
    `${props.active ? 'Calling' : 'Called'} ${props.count} tools`;

  return (
    <div class="min-w-0 text-xs leading-5 text-ink-extra-muted">
      <button
        type="button"
        aria-expanded={expanded()}
        class="flex min-h-7 items-center gap-1 py-1 text-left text-ink-extra-muted hover:text-ink-muted"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <CaretRight
          class="size-4 shrink-0 transition-transform motion-reduce:transition-none"
          classList={{ 'rotate-90': expanded() }}
        />
        <TextShimmer text={title()} active={props.active} />
      </button>
      <Show
        when={expanded()}
        fallback={
          <div class="flex min-w-0 items-center gap-1.5 pl-5 text-ink-placeholder">
            <span class="shrink-0">{props.latest.label}</span>
            <Show when={props.latest.detail}>
              {(detail) => (
                <>
                  <span aria-hidden="true" class="shrink-0">
                    ·
                  </span>
                  <span class="min-w-0 truncate font-mono">{detail()}</span>
                </>
              )}
            </Show>
          </div>
        }
      >
        <div class="flex min-w-0 flex-col gap-1 pl-5">{props.children}</div>
      </Show>
    </div>
  );
}
