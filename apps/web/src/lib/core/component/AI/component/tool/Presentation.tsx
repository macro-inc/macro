import { ItemPreview } from '@core/component/ItemPreview';
import { announcePresentationChanged } from '@core/pptx-engine/changes';
import PresentationIcon from '@phosphor-icons/core/regular/presentation.svg';
import { createSignal, type JSX, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

/** Slide count from the first line of a ReadPresentation description. */
export function describedSlideCount(content: string): number | undefined {
  const match = /^Presentation: (\d+) slides?/.exec(content);
  return match ? Number(match[1]) : undefined;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function PresentationToolRow(props: {
  verb: string;
  documentId: string;
  summary?: string;
  details?: string;
  renderContext: RenderContext['renderContext'];
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      icon={PresentationIcon}
      type="call"
      renderContext={props.renderContext}
      response={
        <Show when={expanded() && props.details}>
          {(details) => (
            <pre class="max-h-80 overflow-auto whitespace-pre-wrap pb-1 font-mono text-ink text-xs">
              {details()}
            </pre>
          )}
        </Show>
      }
    >
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          {props.verb} <span class="text-ink">presentation</span>{' '}
          <span class="text-ink-placeholder">·</span>{' '}
          <Suspense>
            <ItemPreview
              class="inline-flex align-middle ring-0"
              id={props.documentId}
              type="document"
            />
          </Suspense>
        </div>
        <Show when={props.summary}>
          <Tool.ResultToggle
            expanded={expanded()}
            showToggle={!!props.details}
            onToggle={() => setExpanded((value) => !value)}
            status={<span>{props.summary}</span>}
          />
        </Show>
      </div>
    </BaseTool>
  );
}

export const readPresentationHandler = createToolRenderer({
  name: 'ReadPresentation',
  render: (ctx) => {
    const content = () => ctx.response?.data.content;
    const summary = () => {
      const text = content();
      if (text === undefined) return undefined;
      const count = describedSlideCount(text);
      return count === undefined ? 'Read' : plural(count, 'slide');
    };
    return (
      <PresentationToolRow
        verb="Read"
        documentId={ctx.tool.data.documentId}
        summary={summary()}
        details={content()}
        renderContext={ctx.renderContext}
      />
    );
  },
});

export const editPresentationHandler = createToolRenderer({
  name: 'EditPresentation',
  // Open editors of the deck load the version the tool just saved.
  handleResponse: (ctx) => {
    announcePresentationChanged(ctx.tool.data.documentId);
  },
  render: (ctx) => {
    const summary = () =>
      ctx.response
        ? `${plural(ctx.tool.data.operations.length, 'change')} saved`
        : undefined;
    return (
      <PresentationToolRow
        verb="Edit"
        documentId={ctx.tool.data.documentId}
        summary={summary()}
        details={ctx.response?.data.changedSlides || undefined}
        renderContext={ctx.renderContext}
      />
    );
  },
});
