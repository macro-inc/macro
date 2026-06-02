import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { PulsingStar } from '@entity/components/PulsingStar';
import StarIcon from '@icon/wide-star.svg';
import { createSignal, Show } from 'solid-js';
import { Tool } from './Tool';
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
        class="relative overflow-hidden rounded-lg border border-edge-muted bg-surface text-xs leading-5 text-ink-extra-muted"
        classList={{ 'opacity-50': !!error }}
      >
        <div class="flex min-h-9 w-full items-center gap-2 px-3 py-2">
          <div class="size-5 shrink-0 flex items-center justify-center">
            <Show
              when={!isLoading()}
              fallback={<PulsingStar kind="streamIndicator" animate />}
            >
              <StarIcon class="size-4 text-ink-extra-muted" />
            </Show>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <span class="truncate">{ctx.tool.data.task}</span>
              </div>
              <Tool.ResultToggle
                expanded={isExpanded()}
                onToggle={() => setIsExpanded((expanded) => !expanded)}
                showToggle={hasResult()}
                status={statusText()}
              />
            </div>
          </div>
          <Show when={error}>
            <span class="shrink-0 text-ink">Failed</span>
          </Show>
        </div>
        <Show when={hasResult() && isExpanded()}>
          <div class="max-h-120 overflow-y-auto border-t border-edge-muted px-3 py-2 text-xs">
            <ChatMessageMarkdown text={result()!} generating={() => false} />
          </div>
        </Show>
      </div>
    );
  },
});

export const subagentHandler = handler;
