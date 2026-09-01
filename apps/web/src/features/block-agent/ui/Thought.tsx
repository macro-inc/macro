/**
 * The agent's reasoning, modeled on the chat block's `ThinkingBlock`
 * (`@core/component/AI/component/message/ThinkingBlock.tsx`): a bare,
 * borderless row — caret, then a "Thinking"/"Thought" label that shimmers
 * while the turn is in flight — expanding to the reasoning text.
 */

import CaretRight from '@phosphor/caret-right.svg';
import { createSignal, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

export interface ThoughtProps {
  text: string;
  /** The turn is still in flight: label reads "Thinking" and shimmers. */
  active?: boolean;
  defaultOpen?: boolean;
}

export function Thought(props: ThoughtProps) {
  const [expanded, setExpanded] = createSignal(props.defaultOpen ?? false);

  return (
    <div class="relative text-xs leading-5 text-ink-extra-muted">
      <button
        type="button"
        class="flex min-h-7 items-center gap-1 py-1 text-left text-ink-extra-muted hover:text-ink-muted"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <CaretRight
          class="size-4 shrink-0 transition-transform motion-reduce:transition-none"
          classList={{ 'rotate-90': expanded() }}
        />
        <TextShimmer
          text={props.active ? 'Thinking' : 'Thought'}
          active={props.active ?? false}
        />
      </button>
      <Show when={expanded()}>
        <div class="pl-5 text-ink-muted whitespace-pre-wrap wrap-break-word">
          {props.text}
        </div>
      </Show>
    </div>
  );
}
