import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import CaretRight from '@phosphor-icons/core/regular/caret-right.svg';
import Terminal from '@phosphor-icons/core/regular/terminal.svg';
import type { BashCodeExecutionResult } from '@service-cognition/generated/tools/types';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const MAX_COMMAND_LENGTH = 80;

function CodeFence(props: {
  content: string;
  maxLines?: number;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const isCollapsible = () => props.collapsible ?? true;

  const lines = () => props.content.split('\n');
  const needsTruncation = () => {
    if (!isCollapsible()) return false;

    return (
      lines().length > (props.maxLines ?? Number.MAX_SAFE_INTEGER) ||
      props.content.length > MAX_COMMAND_LENGTH
    );
  };

  const displayContent = () => {
    if (expanded() || !needsTruncation()) {
      return props.content;
    }
    return lines()
      .slice(0, props.maxLines)
      .join('\n')
      .slice(0, MAX_COMMAND_LENGTH);
  };

  return (
    <div class="relative">
      <Show when={isCollapsible() && needsTruncation()}>
        <button
          type="button"
          class="text-ink-extra-muted hover:text-ink-muted absolute top-1 right-1 p-1"
          onClick={() => setExpanded(!expanded())}
        >
          <Show when={expanded()} fallback={<CaretRight class="size-4" />}>
            <CaretDown class="size-4" />
          </Show>
        </button>
      </Show>
      <pre
        class="text-ink-muted bg-background-secondary overflow-x-auto rounded p-2 pr-8 font-mono text-xs whitespace-pre-wrap"
        classList={{
          'max-h-24 overflow-hidden':
            isCollapsible() && !expanded() && needsTruncation(),
        }}
      >
        {displayContent()}
      </pre>
    </div>
  );
}

function BashResult(props: { result: BashCodeExecutionResult }) {
  const output = () => {
    const parts: string[] = [];
    if (props.result.stdout) {
      parts.push(props.result.stdout);
    }
    if (props.result.stderr) {
      parts.push(props.result.stderr);
    }
    return parts.join('\n');
  };

  const hasOutput = () => props.result.stdout.trim().length > 0;

  return (
    <div class="flex flex-col gap-1">
      <Show when={props.result.return_code !== 0}>
        <span class="text-ink-error">Exit code {props.result.return_code}</span>
      </Show>
      <Show when={hasOutput()}>
        <CodeFence content={output()} collapsible={false} />
      </Show>
      <Show when={!hasOutput() && props.result.return_code === 0}>
        <span class="text-ink-muted">No output</span>
      </Show>
    </div>
  );
}

const handler = createToolRenderer({
  name: 'bash_code_execution',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);

    return (
      <BaseTool
        icon={Terminal}
        renderContext={ctx.renderContext}
        type="call"
        response={
          isExpanded() ? (
            <div class="flex flex-col gap-2">
              <CodeFence content={ctx.tool.data.command} collapsible={false} />
              <Show when={ctx.response}>
                {(response) => {
                  const isError =
                    response().data.content.type ===
                    'bash_code_execution_tool_result_error';

                  return (
                    <Switch>
                      <Match when={isError}>
                        <span class="text-ink-error">Execution failed</span>
                      </Match>
                      <Match when={!isError}>
                        <BashResult
                          result={
                            response().data.content as BashCodeExecutionResult
                          }
                        />
                      </Match>
                    </Switch>
                  );
                }}
              </Show>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>Code execution</span>
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
              class="size-4 transition-transform"
              classList={{
                'rotate-90': isExpanded(),
              }}
            />
          </button>
        </div>
      </BaseTool>
    );
  },
});

export const bashCodeExecutionHandler = handler;
