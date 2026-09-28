/**
 * The agent's reasoning, modeled on the chat block's `ThinkingBlock`
 * (`@core/component/AI/component/message/ThinkingBlock.tsx`): a bare,
 * borderless row — caret, then a "Thinking"/"Thought" label that shimmers
 * while this thought is still the tail of an open turn — expanding to the
 * reasoning text. Earlier thoughts settle the moment the next part arrives,
 * the same rule production chat uses for `ThinkingBlock`.
 */

import CaretRight from '@phosphor/caret-right.svg';
import { createSignal, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

export interface ThoughtProps {
  text: string;
  /** This thought is still the tail of an open turn: "Thinking" and shimmer. */
  active?: boolean;
  defaultOpen?: boolean;
}

export function Thought(props: ThoughtProps) {
  const [expanded, setExpanded] = createSignal(props.defaultOpen ?? false);

  return (
    <div class="relative text-xs leading-5 text-ink-extra-muted">
      <button
        type="button"
        aria-expanded={expanded()}
        class="flex min-h-7 items-center gap-1 py-1 text-left text-ink-extra-muted hover:text-ink-muted"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <CaretRight
          class="size-4 shrink-0"
          classList={{ 'rotate-90': expanded() }}
        />
        <TextShimmer
          text={props.active ? 'Thinking' : 'Thought'}
          active={props.active ?? false}
        />
      </button>
      <Show when={expanded()}>
        <div class="pl-5 text-ink-muted whitespace-pre-wrap wrap-break-word select-text">
          {props.text}
        </div>
      </Show>
    </div>
  );
}
