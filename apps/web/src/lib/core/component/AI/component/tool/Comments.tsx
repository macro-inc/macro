import { ItemPreview } from '@core/component/ItemPreview';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg';
import ChatCircle from '@phosphor-icons/core/regular/chat-circle.svg';
import ChatsCircle from '@phosphor-icons/core/regular/chats-circle.svg';
import CheckCircle from '@phosphor-icons/core/regular/check-circle.svg';
import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg';
import type { ItemType } from '@service-storage/itemType';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

/** The preview type of each kind of item that carries a Discussion. */
const ITEM_TYPES: Record<string, ItemType> = {
  document: 'document',
  initiative: 'initiative',
  crm_company: 'crm_company',
  crm_contact: 'crm_contact',
};

function discussionItem(
  entityType: string | null | undefined,
  entityId: string | null | undefined
): { id: string; type: ItemType } | undefined {
  if (!entityType || !entityId) return undefined;
  const type = ITEM_TYPES[entityType];
  return type ? { id: entityId, type } : undefined;
}

/** The item a comment is on, once it is known; a reply by thread id learns it from the response. */
function ItemLink(props: {
  item: { id: string; type: ItemType } | undefined;
  fallback: string;
}) {
  return (
    <Show when={props.item} fallback={props.fallback}>
      {(item) => (
        <Suspense>
          <ItemPreview
            class="inline-flex align-middle ring-0"
            id={item().id}
            type={item().type}
          />
        </Suspense>
      )}
    </Show>
  );
}

function CommentBody(props: { markedText?: string; content: string }) {
  return (
    <div class="flex flex-col gap-2 rounded-lg border border-edge-muted bg-ink/[0.02] p-3 text-xs text-ink">
      <Show when={props.markedText}>
        {(text) => (
          <blockquote class="whitespace-pre-wrap break-words border-l-2 border-edge-muted pl-2 text-ink-muted">
            {text()}
          </blockquote>
        )}
      </Show>
      <p class="whitespace-pre-wrap break-words">{props.content}</p>
    </div>
  );
}

export const readDiscussionHandler = createToolRenderer({
  name: 'ReadDiscussion',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const threads = () => ctx.response?.data.threads ?? [];
    const item = () =>
      discussionItem(ctx.tool.data.entityType, ctx.tool.data.entityId);

    return (
      <BaseTool
        icon={ChatsCircle}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <div class="flex flex-col gap-3 rounded-lg border border-edge-muted bg-ink/[0.02] p-3 text-xs text-ink">
              <For each={threads()}>
                {(thread) => (
                  <div class="flex flex-col gap-1">
                    <Show when={thread.markedText}>
                      {(text) => (
                        <blockquote class="whitespace-pre-wrap break-words border-l-2 border-edge-muted pl-2 text-ink-muted">
                          {text()}
                        </blockquote>
                      )}
                    </Show>
                    <For each={thread.comments}>
                      {(comment) => (
                        <p class="whitespace-pre-wrap break-words">
                          {comment.content ?? 'Deleted comment'}
                        </p>
                      )}
                    </For>
                    <Show when={thread.resolved}>
                      <span class="text-ink-muted">Resolved</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0">
            {ctx.response ? 'Read the discussion on' : 'Read the discussion on'}{' '}
            <ItemLink item={item()} fallback="an item" />
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={threads().length > 0}
          />
        </div>
      </BaseTool>
    );
  },
});

export const commentHandler = createToolRenderer({
  name: 'Comment',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const reply = () => ctx.tool.data.threadId != null;
    const item = () =>
      discussionItem(
        ctx.response?.data.entityType ?? ctx.tool.data.entityType,
        ctx.response?.data.entityId ?? ctx.tool.data.entityId
      );
    const verb = () => {
      if (reply())
        return ctx.response
          ? 'Replied to a comment on'
          : 'Reply to a comment on';
      return ctx.response ? 'Commented on' : 'Comment on';
    };

    return (
      <BaseTool
        icon={ChatCircle}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <CommentBody content={ctx.tool.data.content} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0">
            {verb()}{' '}
            <ItemLink
              item={item()}
              fallback={reply() ? 'a comment thread' : 'an item'}
            />
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

export const commentOnTextHandler = createToolRenderer({
  name: 'CommentOnText',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const markedText = () =>
      ctx.response?.data.markedText ?? ctx.tool.data.quote;

    return (
      <BaseTool
        icon={ChatCircle}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <CommentBody
              markedText={markedText()}
              content={ctx.tool.data.content}
            />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0">
            {ctx.response ? 'Commented on text in' : 'Comment on text in'}{' '}
            <ItemLink
              item={{ id: ctx.tool.data.documentId, type: 'document' }}
              fallback="a document"
            />
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

export const resolveCommentHandler = createToolRenderer({
  name: 'ResolveComment',
  render: (ctx) => {
    const resolving = () => ctx.tool.data.resolved !== false;
    const verb = () => {
      if (resolving()) return ctx.response ? 'Resolved' : 'Resolve';
      return ctx.response ? 'Reopened' : 'Reopen';
    };
    const item = () =>
      discussionItem(
        ctx.response?.data.entityType,
        ctx.response?.data.entityId
      );

    return (
      <BaseTool
        icon={resolving() ? CheckCircle : ArrowCounterClockwise}
        renderContext={ctx.renderContext}
        type="call"
      >
        <div class="min-w-0 flex-1">
          {verb()} a comment{' '}
          <Show when={item()}>
            {(item) => (
              <>
                on <ItemLink item={item()} fallback="" />
              </>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});

export const editCommentHandler = createToolRenderer({
  name: 'EditComment',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const item = () =>
      discussionItem(
        ctx.response?.data.entityType,
        ctx.response?.data.entityId
      );

    return (
      <BaseTool
        icon={PencilSimple}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() ? (
            <CommentBody content={ctx.tool.data.content} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0">
            {ctx.response ? 'Edited a comment' : 'Edit a comment'}{' '}
            <Show when={item()}>
              {(item) => (
                <>
                  on <ItemLink item={item()} fallback="" />
                </>
              )}
            </Show>
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

export const deleteCommentHandler = createToolRenderer({
  name: 'DeleteComment',
  render: (ctx) => {
    const noun = () =>
      ctx.response?.data.deletedThread ? 'a comment thread' : 'a comment';
    const item = () =>
      discussionItem(
        ctx.response?.data.entityType,
        ctx.response?.data.entityId
      );

    return (
      <BaseTool icon={Trash} renderContext={ctx.renderContext} type="call">
        <div class="min-w-0 flex-1">
          {ctx.response ? 'Deleted' : 'Delete'} {noun()}{' '}
          <Show when={item()}>
            {(item) => (
              <>
                on <ItemLink item={item()} fallback="" />
              </>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});
