import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import CaretRight from '@phosphor-icons/core/regular/caret-right.svg';
import Terminal from '@phosphor-icons/core/regular/terminal.svg';
import type { BashCodeExecutionResult } from '@service-cognition/generated/tools/types';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const MAX_COMMAND_LENGTH = 80;
const MAX_OUTPUT_LINES = 3;

function truncateCommand(command: string): string {
  const firstLine = command.split('\n')[0] ?? '';
  const needsTruncation =
    command.includes('\n') || firstLine.length > MAX_COMMAND_LENGTH;

  if (needsTruncation) {
    return `${firstLine.slice(0, MAX_COMMAND_LENGTH)}...`;
  }
  return firstLine;
}

function CodeFence(props: { content: string; maxLines: number }) {
  const [expanded, setExpanded] = createSignal(false);

  const lines = () => props.content.split('\n');
  const needsTruncation = () =>
    lines().length > props.maxLines ||
    props.content.length > MAX_COMMAND_LENGTH;

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
      <Show when={needsTruncation()}>
        <button
          type="button"
          class="text-ink-extra-muted hover:text-ink-muted absolute top-1 right-1 p-1"
          onClick={() => setExpanded(!expanded())}
        >
          <Show when={expanded()} fallback={<CaretRight class="h-4 w-4" />}>
            <CaretDown class="h-4 w-4" />
          </Show>
        </button>
      </Show>
      <pre
        class="text-ink-muted bg-background-secondary overflow-x-auto rounded p-2 pr-8 font-mono text-xs whitespace-pre-wrap"
        classList={{
          'max-h-24 overflow-hidden': !expanded() && needsTruncation(),
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
        <CodeFence content={output()} maxLines={MAX_OUTPUT_LINES} />
      </Show>
      <Show when={!hasOutput() && props.result.return_code === 0}>
        <span class="text-ink-muted">No output</span>
      </Show>
    </div>
  );
}

const handler = createToolRenderer({
  name: 'bash_code_execution',
  renderCall: (ctx) => (
    <BaseTool icon={Terminal} renderContext={ctx.renderContext} type="call">
      <code class="text-ink-muted font-mono text-xs">
        {truncateCommand(ctx.tool.data.command)}
      </code>
    </BaseTool>
  ),
  renderResponse: (ctx) => {
    const isError =
      ctx.toolResponse.tool.data.content.type ===
      'bash_code_execution_tool_result_error';
    return (
      <BaseTool renderContext={ctx.renderContext} type="response">
        <Switch>
          <Match when={isError}>
            <span class="text-ink-error">Execution failed</span>
          </Match>
          <Match when={!isError}>
            <BashResult
              result={
                ctx.toolResponse.tool.data.content as BashCodeExecutionResult
              }
            />
          </Match>
        </Switch>
      </BaseTool>
    );
  },
});

export const bashCodeExecutionHandler = handler;
