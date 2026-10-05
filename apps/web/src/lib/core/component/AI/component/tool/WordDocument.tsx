import { ItemPreview } from '@core/component/ItemPreview';
import FileDocIcon from '@phosphor/file-doc.svg';
import { createSignal, type JSX, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

/** Block count from the first line of a ReadWordDocument description. */
export function describedBlockCount(content: string): number | undefined {
  const match = /^Word document with (\d+) blocks?/.exec(content);
  return match ? Number(match[1]) : undefined;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function WordDocumentToolRow(props: {
  verb: string;
  documentId: string;
  summary?: string;
  details?: string;
  renderContext: RenderContext['renderContext'];
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      icon={FileDocIcon}
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
          {props.verb} <span class="text-ink">Word document</span>{' '}
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

export const readWordDocumentHandler = createToolRenderer({
  name: 'ReadWordDocument',
  render: (ctx) => {
    const content = () => ctx.response?.data.content;
    const summary = () => {
      const text = content();
      if (text === undefined) return undefined;
      const count = describedBlockCount(text);
      return count === undefined ? 'Read' : plural(count, 'block');
    };
    return (
      <WordDocumentToolRow
        verb="Read"
        documentId={ctx.tool.data.documentId}
        summary={summary()}
        details={content()}
        renderContext={ctx.renderContext}
      />
    );
  },
});

// Open editors receive the edit through the sync service; nothing to announce.
export const editWordDocumentHandler = createToolRenderer({
  name: 'EditWordDocument',
  render: (ctx) => {
    const summary = () =>
      ctx.response
        ? `${plural(ctx.tool.data.operations.length, 'change')} applied`
        : undefined;
    return (
      <WordDocumentToolRow
        verb="Edit"
        documentId={ctx.tool.data.documentId}
        summary={summary()}
        details={ctx.response?.data.content}
        renderContext={ctx.renderContext}
      />
    );
  },
});
