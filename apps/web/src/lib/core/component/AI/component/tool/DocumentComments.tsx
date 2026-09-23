import { ItemPreview } from '@core/component/ItemPreview';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg';
import ChatCircle from '@phosphor-icons/core/regular/chat-circle.svg';
import CheckCircle from '@phosphor-icons/core/regular/check-circle.svg';
import { createSignal, Suspense } from 'solid-js';
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

export const replyToDocumentCommentHandler = createToolRenderer({
  name: 'ReplyToDocumentComment',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const verb = () => {
      const reply = ctx.tool.data.threadId != null;
      if (ctx.response)
        return reply ? 'Replied to a comment on' : 'Commented on';
      return reply ? 'Reply to a comment on' : 'Comment on';
    };

    return (
      <BaseTool
        icon={ChatCircle}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <p class="whitespace-pre-wrap break-words rounded-lg border border-edge-muted bg-ink/[0.02] p-3 text-xs text-ink">
              {ctx.tool.data.content}
            </p>
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
