import { ItemPreview } from '@core/component/ItemPreview';
import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import { createSignal, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

function CanvasToolRow(props: {
  verb: string;
  documentId: string;
  summary?: string;
  details?: string;
  image?: string;
  renderContext: RenderContext['renderContext'];
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <BaseTool
      icon={PencilSimple}
      type="call"
      renderContext={props.renderContext}
      response={
        <>
          <Show when={expanded() && props.image}>
            {(src) => (
              <img
                src={src()}
                alt="Canvas snapshot"
                class="max-h-96 max-w-full object-contain"
              />
            )}
          </Show>
          <Show when={expanded() && props.details}>
            {(details) => (
              <pre class="max-h-80 overflow-auto whitespace-pre-wrap pb-1 font-mono text-ink text-xs">
                {details()}
              </pre>
            )}
          </Show>
        </>
      }
    >
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          {props.verb} canvas{' '}
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

export const readCanvasHandler = createToolRenderer({
  name: 'ReadCanvas',
  render: (ctx) => (
    <CanvasToolRow
      verb="Read"
      documentId={ctx.tool.data.document_id}
      summary={ctx.response?.data.summary}
      details={ctx.response?.data.canvas ?? undefined}
      renderContext={ctx.renderContext}
    />
  ),
});

export const renderCanvasHandler = createToolRenderer({
  name: 'RenderCanvas',
  render: (ctx) => (
    <CanvasToolRow
      verb={ctx.response ? 'Rendered' : 'Render'}
      documentId={ctx.tool.data.document_id}
      summary={
        ctx.response
          ? `${ctx.response.data.width} × ${ctx.response.data.height}`
          : undefined
      }
      image={
        ctx.response?.data.modelMedia[0]
          ? `data:image/png;base64,${ctx.response.data.modelMedia[0].data}`
          : undefined
      }
      details={
        ctx.response
          ? JSON.stringify(
              {
                revision: ctx.response.data.revision,
                crop: ctx.response.data.crop,
                objects: ctx.response.data.objects,
                textLayout: ctx.response.data.textLayout,
                unavailable: ctx.response.data.unavailable,
              },
              null,
              2
            )
          : undefined
      }
      renderContext={ctx.renderContext}
    />
  ),
});

export const editCanvasHandler = createToolRenderer({
  name: 'EditCanvas',
  render: (ctx) => (
    <CanvasToolRow
      verb="Edit"
      documentId={ctx.tool.data.document_id}
      summary={
        ctx.response
          ? `${ctx.response.data.operationsApplied} operation${ctx.response.data.operationsApplied === 1 ? '' : 's'}`
          : undefined
      }
      details={
        ctx.response
          ? [ctx.response.data.summary, ctx.response.data.clarification]
              .filter(Boolean)
              .join('\n\n')
          : undefined
      }
      renderContext={ctx.renderContext}
    />
  ),
});

export const applyCanvasEditsHandler = createToolRenderer({
  name: 'ApplyCanvasEdits',
  render: (ctx) => (
    <CanvasToolRow
      verb="Edit"
      documentId={ctx.tool.data.document_id}
      summary={
        ctx.response
          ? `${ctx.response.data.operationsApplied} operation${ctx.response.data.operationsApplied === 1 ? '' : 's'}`
          : undefined
      }
      details={
        ctx.response
          ? [ctx.response.data.summary, ctx.response.data.clarification]
              .filter(Boolean)
              .join('\n\n')
          : undefined
      }
      renderContext={ctx.renderContext}
    />
  ),
});
