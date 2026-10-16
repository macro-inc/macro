import CaretRight from '@phosphor/caret-right.svg';
import Sparkle from '@phosphor/sparkle.svg';
import { createSignal, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

function CognitionResult(props: {
  label: string;
  summary?: string;
  result: unknown;
  renderContext: RenderContext['renderContext'];
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      icon={Sparkle}
      renderContext={props.renderContext}
      type="call"
      response={
        <Show when={expanded()}>
          <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
            {JSON.stringify(props.result, null, 2)}
          </pre>
        </Show>
      }
    >
      <span class="flex-1">{props.label}</span>
      <Show when={props.result !== undefined}>
        <button
          type="button"
          aria-label={`Show ${props.label.toLowerCase()} result`}
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
          class="flex items-center gap-2"
        >
          <span>{props.summary ?? 'Complete'}</span>
          <CaretRight
            class="size-3.5"
            classList={{ 'rotate-90': expanded() }}
          />
        </button>
      </Show>
    </BaseTool>
  );
}

export const generateObjectHandler = createToolRenderer({
  name: 'GenerateObject',
  render: (ctx) => (
    <CognitionResult
      label="Generate structured answer"
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});

export const decideHandler = createToolRenderer({
  name: 'Decide',
  render: (ctx) => (
    <CognitionResult
      label="Classify supplied information"
      summary={
        ctx.response
          ? `${Object.keys(ctx.response.data.probabilities).length} estimates`
          : undefined
      }
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});
