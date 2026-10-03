import { ItemPreview } from '@core/component/ItemPreview';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg';
import ChatCircle from '@phosphor-icons/core/regular/chat-circle.svg';
import CheckCircle from '@phosphor-icons/core/regular/check-circle.svg';
import { createSignal, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

function DocumentPreview(props: { documentId: string }) {
  return (
    <Suspense>
      <ItemPreview
        class="inline-flex align-middle ring-0"
        id={props.documentId}
        type="document"
      />
    </Suspense>
  );
}

export const commentOnDocumentHandler = createToolRenderer({
  name: 'CommentOnDocument',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const markedText = () =>
      ctx.response?.data.markedText ?? ctx.tool.data.quote;

    const verb = () => {
      if (ctx.tool.data.threadId != null)
        return ctx.response
          ? 'Replied to a comment on'
          : 'Reply to a comment on';
      if (ctx.tool.data.quote != null)
        return ctx.response ? 'Commented on text in' : 'Comment on text in';
      return ctx.response ? 'Commented on' : 'Comment on';
    };

    return (
      <BaseTool
        icon={ChatCircle}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <div class="flex flex-col gap-2 rounded-lg border border-edge-muted bg-ink/[0.02] p-3 text-xs text-ink">
              <Show when={markedText()}>
                {(text) => (
                  <blockquote class="whitespace-pre-wrap break-words border-l-2 border-edge-muted pl-2 text-ink-muted">
                    {text()}
                  </blockquote>
                )}
              </Show>
              <p class="whitespace-pre-wrap break-words">
                {ctx.tool.data.content}
              </p>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0">
            {verb()} <DocumentPreview documentId={ctx.tool.data.documentId} />
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={!!ctx.tool.data.content}
          />
        </div>
      </BaseTool>
    );
  },
});

export const resolveDocumentCommentHandler = createToolRenderer({
  name: 'ResolveDocumentComment',
  render: (ctx) => {
    const resolving = () => ctx.tool.data.resolved !== false;
    const verb = () => {
      if (resolving()) return ctx.response ? 'Resolved' : 'Resolve';
      return ctx.response ? 'Reopened' : 'Reopen';
    };

    return (
      <BaseTool
        icon={resolving() ? CheckCircle : ArrowCounterClockwise}
        renderContext={ctx.renderContext}
        type="call"
      >
        <div class="min-w-0 flex-1">
          {verb()} a comment on{' '}
          <DocumentPreview documentId={ctx.tool.data.documentId} />
        </div>
      </BaseTool>
    );
  },
});
