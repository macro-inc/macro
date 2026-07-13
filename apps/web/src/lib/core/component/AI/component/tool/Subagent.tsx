import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { PulsingStar } from '@entity/components/PulsingStar';
import StarIcon from '@icon/wide-star.svg';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
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
    const Icon = (props: JSX.SvgSVGAttributes<SVGSVGElement>) => (
      <Show
        when={!isLoading()}
        fallback={
          <PulsingStar
            kind="streamIndicator"
            animate
            class={typeof props.class === 'string' ? props.class : undefined}
          />
        }
      >
        <StarIcon {...props} />
      </Show>
    );

    return (
      <BaseTool
        icon={Icon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResult() && isExpanded() ? (
            <div class="max-h-120 overflow-y-auto text-xs">
              <ChatMessageMarkdown text={result()!} generating={() => false} />
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <span class="min-w-0 truncate">{ctx.tool.data.task}</span>
          </div>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResult()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const subagentHandler = handler;
