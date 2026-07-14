import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import CaretRight from '@phosphor/caret-right.svg?component-solid';
import { createSignal, Show } from 'solid-js';

export function ThinkingBlock(props: {
  thinking: string;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="relative text-xs leading-5 text-ink-extra-muted">
      <button
        type="button"
        class="flex min-h-7 items-center gap-1 py-1 text-left text-ink-extra-muted hover:text-ink-muted"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <CaretRight
          class="size-4 shrink-0 transition-transform"
          classList={{ 'rotate-90': expanded() }}
        />
        <span>{props.isStreaming ? 'Thinking' : 'Thought'}</span>
      </button>
      <Show when={expanded()}>
        <div class="pb-0 pl-5 text-ink-muted">
          <ChatMessageMarkdown
            text={props.thinking}
            generating={() => props.isStreaming}
          />
        </div>
      </Show>
    </div>
  );
}
