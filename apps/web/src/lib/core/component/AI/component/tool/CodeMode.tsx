import CaretRight from '@phosphor/caret-right.svg';
import CodeIcon from '@phosphor/code.svg';
import { createSignal, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

export const describeCodeToolsHandler = createToolRenderer({
  name: 'DescribeCodeTools',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    return (
      <BaseTool
        icon={CodeIcon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          <Show when={expanded()}>
            <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
              {JSON.stringify(ctx.response?.data, null, 2)}
            </pre>
          </Show>
        }
      >
        <span class="flex-1">Discover code tools</span>
        <Show when={ctx.response}>
          <button
            type="button"
            aria-label="Show SDK documentation"
            aria-expanded={expanded()}
            onClick={() => setExpanded(!expanded())}
            class="flex items-center gap-2"
          >
            <span>{ctx.response?.data.tools.length} methods</span>
            <CaretRight
              class="size-3.5"
              classList={{ 'rotate-90': expanded() }}
            />
          </button>
        </Show>
      </BaseTool>
    );
  },
});

/** Fallback for hosts without session records; agent sessions use CodeExecutionPart. */
export const executeCodeHandler = createToolRenderer({
  name: 'ExecuteCode',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    return (
      <BaseTool
        icon={CodeIcon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          <Show when={expanded()}>
            <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
              {JSON.stringify(ctx.response?.data, null, 2)}
            </pre>
          </Show>
        }
      >
        <span class="flex-1">Run code</span>
        <Show when={ctx.response}>
          <button
            type="button"
            aria-label="Show code result"
            aria-expanded={expanded()}
            onClick={() => setExpanded(!expanded())}
            class="flex items-center gap-2"
          >
            <span>{ctx.response?.data.status}</span>
            <CaretRight
              class="size-3.5"
              classList={{ 'rotate-90': expanded() }}
            />
          </button>
        </Show>
      </BaseTool>
    );
  },
});
