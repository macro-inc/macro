/**
 * The agent's reasoning, modeled on the chat block's `ThinkingBlock`
 * (`@core/component/AI/component/message/ThinkingBlock.tsx`): a bare,
 * borderless row — a "Thinking"/"Thought" label that shimmers while this
 * thought is still the tail of an open turn, then a caret on hover —
 * expanding to the reasoning text. While live it leads with the working
 * dots, where `WorkingLine` had them. Earlier thoughts settle the moment the
 * next part arrives, the same rule production chat uses for `ThinkingBlock`.
 */

import { createSignal, Show } from 'solid-js';
import { DisclosureCaret } from './DisclosureCaret';
import { TextShimmer } from './TextShimmer';
import { WorkingDots } from './WorkingDots';

export interface ThoughtProps {
  text: string;
  /** This thought is still the tail of an open turn: "Thinking" and shimmer. */
  active?: boolean;
  defaultOpen?: boolean;
}

export function Thought(props: ThoughtProps) {
  const [expanded, setExpanded] = createSignal(props.defaultOpen ?? false);

  return (
    <div class="relative text-sm leading-6 text-ink-extra-muted">
      <button
        type="button"
        aria-expanded={expanded()}
        class="group flex min-h-8 items-center gap-2 py-1 text-left text-ink-extra-muted not-touch:hover:text-ink-muted"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Show when={props.active}>
          <WorkingDots />
        </Show>
        <TextShimmer
          text={props.active ? 'Thinking' : 'Thought'}
          active={props.active ?? false}
        />
        <DisclosureCaret open={expanded()} />
      </button>
      <Show when={expanded()}>
        <div class="text-ink-muted whitespace-pre-wrap wrap-break-word select-text">
          {props.text}
        </div>
      </Show>
    </div>
  );
}
