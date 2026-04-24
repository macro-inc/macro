import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { PulsingStar } from '@entity/components/PulsingStar';
import CaretRight from '@icon/regular/caret-right.svg?component-solid';
import StarIcon from '@macro-icons/wide/star.svg';
import { createSignal, Show } from 'solid-js';
import { createToolRenderer, useToolError } from './ToolRenderer';

const handler = createToolRenderer({
  name: 'Subagent',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const error = useToolError();
    const isLoading = () => !ctx.response && !error;
    const result = () => ctx.response?.data.result;
    const hasResult = () => !!result();
    const statusText = () => {
      if (isLoading()) return 'Working…';
      if (error) return undefined;
      return hasResult() ? 'Done' : 'No result';
    };

    return (
      <div
        class="relative text-sm text-ink-extra-muted border-l pl-4 border-edge"
        classList={{ 'opacity-50': !!error }}
      >
        <div class="flex w-full items-center gap-x-2">
          <div class="size-[20px] shrink-0 flex items-center justify-center">
            <Show
              when={!isLoading()}
              fallback={<PulsingStar kind="streamIndicator" animate />}
            >
              <StarIcon class="size-4 text-accent" />
            </Show>
          </div>
          <div class="min-w-0 flex-1 p-2">
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <span class="truncate">{ctx.tool.data.task}</span>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <Show when={statusText()}>
                  {(text) => (
                    <span class="text-xs text-ink-extra-muted">{text()}</span>
                  )}
                </Show>
                <Show when={hasResult()}>
                  <button
                    type="button"
                    class="shrink-0 text-ink-muted hover:text-ink p-1"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsExpanded((expanded) => !expanded);
                    }}
                  >
                    <CaretRight
                      class="h-4 w-4 transition-transform"
                      classList={{
                        'rotate-90': isExpanded(),
                      }}
                    />
                  </button>
                </Show>
              </div>
            </div>
          </div>
          <Show when={error}>
            <span class="shrink-0 pr-2 text-ink-muted">Failed</span>
          </Show>
        </div>
        <Show when={hasResult() && isExpanded()}>
          <div class="pl-8 mb-2 max-h-[480px] overflow-y-auto text-sm">
            <ChatMessageMarkdown text={result()!} generating={() => false} />
          </div>
        </Show>
      </div>
    );
  },
});

export const subagentHandler = handler;
