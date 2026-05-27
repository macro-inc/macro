import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import CaretRight from '@phosphor/caret-right.svg?component-solid';
import BrainIcon from '@phosphor-icons/core/regular/brain.svg?component-solid';
import { createSignal, Show } from 'solid-js';

export function ThinkingBlock(props: {
  thinking: string;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="relative text-sm text-ink-extra-muted border-l pl-4 border-edge">
      <div class="flex w-full items-center gap-x-2">
        <BrainIcon class="size-5 shrink-0 text-accent" />
        <div class="min-w-0 flex-1 p-2">
          <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span>{props.isStreaming ? 'Thinking' : 'Thought'}</span>
            <div class="flex shrink-0 items-center gap-1">
              <span class="text-xs text-ink-extra-muted">
                {props.thinking.length} chars
              </span>
              <button
                type="button"
                class="shrink-0 text-ink-muted hover:text-ink p-1"
                onClick={() => setExpanded((prev) => !prev)}
              >
                <CaretRight
                  class="size-4 transition-transform"
                  classList={{ 'rotate-90': expanded() }}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
      <Show when={expanded()}>
        <div class="pl-8 mb-2 text-ink-muted">
          <ChatMessageMarkdown
            text={props.thinking}
            generating={() => props.isStreaming}
          />
        </div>
      </Show>
    </div>
  );
}
