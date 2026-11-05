import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { PulsingStar } from '@entity/components/PulsingStar';
import StarIcon from '@icon/system/regular/sparkle.svg';
import { Tooltip } from '@ui/components/Tooltip';
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, useToolError } from './ToolRenderer';

/**
 * What to call the delegated work: the call's short description, else the
 * first line of its instructions.
 */
function subagentTitle(data: {
  description?: string | null;
  task: string;
}): string {
  return (
    data.description?.trim() ||
    data.task
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ||
    'Subagent'
  );
}

const handler = createToolRenderer({
  name: 'Subagent',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const error = useToolError();
    const isLoading = () => !ctx.response && !error;
    const result = () => ctx.response?.data.result;
    const statusText = () => {
      if (isLoading()) return 'Running';
      if (error) return undefined;
      return result() ? 'Done' : 'No result';
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
          isExpanded() ? (
            <div class="flex flex-col gap-2 text-xs">
              <section class="flex flex-col gap-1">
                <h4 class="text-ink-disabled">Instructions</h4>
                <p class="max-h-40 overflow-y-auto overscroll-contain whitespace-pre-wrap wrap-break-word">
                  {ctx.tool.data.task}
                </p>
              </section>
              <Show when={result()}>
                {(text) => (
                  <section class="flex flex-col gap-1">
                    <h4 class="text-ink-disabled">Result</h4>
                    <div class="max-h-120 overflow-y-auto">
                      <ChatMessageMarkdown
                        text={text()}
                        generating={() => false}
                      />
                    </div>
                  </section>
                )}
              </Show>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <Tooltip
            label={subagentTitle(ctx.tool.data)}
            as="span"
            class="min-w-0 flex-1 truncate"
          >
            {subagentTitle(ctx.tool.data)}
          </Tooltip>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const subagentHandler = handler;
