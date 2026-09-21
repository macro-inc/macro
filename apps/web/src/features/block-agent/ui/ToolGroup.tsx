/**
 * A run of consecutive tool calls.
 *
 * The run reads as a list, not as a lid. Every call keeps its row, because
 * the row is already one line: hiding it behind "Called 5 tools" cost a click
 * and paid back nothing the rows did not already say, and it put two
 * different meanings on the same caret — open the run, then open a call.
 *
 * Only a long run folds, and only in the middle: the calls it opened with and
 * the ones it got to both stay, and the fold says how many it swallowed. A
 * live run never folds — that is the work happening now.
 */

import DotsThree from '@phosphor/dots-three.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';

/** Rows kept at each end of a folded run. */
const EDGE = 2;

/** Above this many calls a settled run folds — enough to hide at least three. */
const FOLD_ABOVE = EDGE * 2 + 2;

export interface ToolGroupProps {
  /**
   * The parts' indices within their message, in order. Indices rather than
   * the parts themselves: they are stable values, so a row keeps its DOM —
   * and a card its open state — while the run grows or the fold opens.
   */
  indices: readonly number[];
  /** A call in the run is still in flight: the run stays whole. */
  active: boolean;
  /** Renders the part at an index. */
  children: (index: number) => JSX.Element;
}

export function ToolGroup(props: ToolGroupProps) {
  const [expanded, setExpanded] = createSignal(false);
  const folded = () =>
    !props.active && !expanded() && props.indices.length > FOLD_ABOVE;
  const head = () => (folded() ? props.indices.slice(0, EDGE) : props.indices);
  const tail = () => (folded() ? props.indices.slice(-EDGE) : []);
  const hidden = () => props.indices.length - EDGE * 2;

  return (
    <div class="flex min-w-0 flex-col gap-1">
      <For each={head()}>{(index) => props.children(index)}</For>
      <Show when={folded()}>
        <button
          type="button"
          class="flex min-h-7 items-center gap-1.5 px-3 py-1 text-left text-xs leading-5 text-ink-extra-muted hover:text-ink-muted"
          onClick={() => setExpanded(true)}
        >
          <DotsThree aria-hidden="true" class="size-3.5 shrink-0" />
          <span>
            {hidden()} more {hidden() === 1 ? 'tool' : 'tools'}
          </span>
        </button>
      </Show>
      <For each={tail()}>{(index) => props.children(index)}</For>
    </div>
  );
}
