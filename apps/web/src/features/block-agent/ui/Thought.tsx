/**
 * The agent's reasoning, modeled on the chat block's `ThinkingBlock`
 * (`@core/component/AI/component/message/ThinkingBlock.tsx`): a bare,
 * borderless row — caret, then a "Thinking"/"Thought" label that shimmers
 * while the turn is in flight — expanding to the reasoning text.
 */

import CaretRight from '@phosphor/caret-right.svg';
import Sparkle from '@phosphor/sparkle.svg';
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
    <div class="relative text-[13px] leading-5 text-ink-extra-muted">
      <button
        type="button"
        class="group flex min-h-10 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-1.5 text-left text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-expanded={expanded()}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Sparkle class="size-4 shrink-0 text-ink-muted" />
        <TextShimmer
          text={props.active ? 'Thinking' : 'Reasoning'}
          active={props.active ?? false}
        />
        <span class="min-w-0 flex-1 truncate px-1 py-1 text-xs text-ink-muted">
          {props.text.split('\n')[0]}
        </span>
        <CaretRight
          class="size-4 shrink-0 transition-transform motion-reduce:transition-none"
          classList={{ 'rotate-90': expanded() }}
        />
      </button>
      <Show when={expanded()}>
        <div class="my-2 ml-5 border-l border-edge-muted px-4 py-1 text-ink-muted whitespace-pre-wrap wrap-break-word">
          {props.text}
        </div>
      </Show>
    </div>
  );
}
