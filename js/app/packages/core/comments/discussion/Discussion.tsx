import type { InputSnapshot } from '@channel/Input/types';
import { Message } from '@channel/Message/Message';
import type { MessageActions } from '@channel/Message/types';
import { Thread } from '@channel/Thread/Thread';
import { ThreadRail } from '@channel/Thread/ThreadRail';
import { ThreadReplyInputConnector } from '@channel/Thread/ThreadReplyInputConnector';
import { replyInputOffsetX } from '@channel/Thread/utils/thread-rail-geometry';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { tryMacroId, useDisplayName } from '@core/user';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import { useDiscussion } from './context';
import { DiscussionInput } from './DiscussionInput';
import {
  discussionCommentToApiChannelMessage,
  discussionCommentToMessageData,
} from './messageAdapter';
import type {
  DiscussionComment,
  DiscussionThread as ViewThread,
} from './types';

/**
 * Renders a collapsible discussion (threads + composer) from the current
 * [`DiscussionSource`]. Backend-agnostic: drive it via a `DiscussionProvider`
 * supplying a document/task or CRM source.
 */
export function Discussion() {
  const source = useDiscussion();
  const [isExpanded, setIsExpanded] = createSignal(true);

  // Deep-linking to a comment expands the discussion.
  createEffect(() => {
    if (source.targetCommentId() !== null) setIsExpanded(true);
  });

  let newThreadInputHandle: { clear: () => void } | undefined;

  const handleCreateThread = async (snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    await source.createThread(text, snapshot.mentions);
    newThreadInputHandle?.clear();
  };

  return (
    <section class="mt-8 pb-12">
      <div class="flex items-center gap-2 pt-2">
        <div class="w-6 border-t border-edge-muted" />
        <button
          type="button"
          class="flex items-center gap-1 px-2 hover:opacity-70 transition-opacity"
          onClick={() => setIsExpanded(!isExpanded())}
        >
          {isExpanded() ? (
            <CaretDown class="size-3" />
          ) : (
            <CaretRight class="size-3" />
          )}
          <span class="text-xs">Discussion</span>
        </button>
        <div class="flex-1 border-t border-edge-muted" />
      </div>

      <Show when={isExpanded()}>
        <StaticMarkdownContext>
          <div class="py-2 text-xs">
            <div>
              <For each={source.threads()}>
                {(thread) => <DiscussionThreadView thread={thread} />}
              </For>
            </div>

            <Show when={source.canEdit()}>
              <div>
                <DiscussionInput
                  input={{ mode: 'channel', placeholder: 'Leave a comment...' }}
                  onSend={handleCreateThread}
                  onReady={(handle) => {
                    newThreadInputHandle = handle;
                  }}
                  autofocus={false}
                />
              </div>
            </Show>
          </div>
        </StaticMarkdownContext>
      </Show>
    </section>
  );
}

function DiscussionThreadView(props: { thread: ViewThread }) {
  const source = useDiscussion();
  const canEdit = source.canEdit;

  const [isReplying, setIsReplying] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  let replyInputHandle: { clear: () => void } | undefined;
  let replyInputContainerRef: HTMLDivElement | undefined;

  const comments = () => props.thread.comments;
  const root = () => comments()[0];
  const replies = () => comments().slice(1);
  const hasReplies = () => replies().length > 0;
  const threadId = () => props.thread.id;

  const replyUserId = () => source.currentUserId() ?? root()?.authorId ?? '';
  const macroId = () => tryMacroId(replyUserId());
  const [displayName] = useDisplayName(macroId());

  const isOwn = (comment: DiscussionComment) =>
    comment.authorId === source.currentUserId();

  // undefined when the source has no deep-linking — hides the copy-link button.
  const makeCopyLink = (comment: DiscussionComment) => {
    const build = source.buildCommentLink;
    if (!build) return undefined;
    return async () => {
      try {
        const url = build(comment);
        await navigator.clipboard.writeText(url);
        toast.success('Link copied to clipboard');
      } catch {
        toast.failure('Could not copy link');
      }
    };
  };

  const makeActions = (
    comment: DiscussionComment,
    isRoot: boolean
  ): MessageActions => {
    const own = isOwn(comment);
    return {
      onReply:
        isRoot && canEdit()
          ? () => {
              setIsReplying(true);
            }
          : undefined,
      onEdit: own
        ? () => {
            setEditingId(comment.id);
          }
        : undefined,
      onDelete:
        own && canEdit()
          ? async () => {
              await source.deleteComment(comment);
            }
          : undefined,
      onCopyLink: makeCopyLink(comment),
    };
  };

  const handleReply = async (snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    await source.createReply(threadId(), text, snapshot.mentions);
    replyInputHandle?.clear();
    setIsReplying(false);
  };

  const handleEdit = async (
    comment: DiscussionComment,
    snapshot: InputSnapshot
  ) => {
    const text = snapshot.value.trim();
    if (!text) return;
    await source.editComment(comment, text);
    setEditingId(null);
  };

  return (
    <Show when={root()}>
      {(rootComment) => {
        const rootMessageData = () =>
          discussionCommentToApiChannelMessage(rootComment());
        return (
          <div class="flex flex-col w-full gap-0">
            <Thread.Row message={rootMessageData()}>
              <DiscussionMessageView
                comment={rootComment()}
                actions={makeActions(rootComment(), true)}
                editingId={editingId()}
                onEditSave={(snapshot) => handleEdit(rootComment(), snapshot)}
                onEditCancel={() => setEditingId(null)}
                isHighlighted={source.targetCommentId() === rootComment().id}
              />

              <Show when={hasReplies() || isReplying()}>
                <div class="relative w-full">
                  <Thread.ReplyRailDecorations
                    isReplying={isReplying}
                    firstThreadReplyNewMessage={false}
                  />
                  <Thread.RepliesContainer>
                    <For each={replies()}>
                      {(reply) => (
                        <div class="relative">
                          <ThreadRail />
                          <DiscussionMessageView
                            comment={reply}
                            actions={makeActions(reply, false)}
                            editingId={editingId()}
                            onEditSave={(snapshot) =>
                              handleEdit(reply, snapshot)
                            }
                            onEditCancel={() => setEditingId(null)}
                            isHighlighted={
                              source.targetCommentId() === reply.id
                            }
                          />
                        </div>
                      )}
                    </For>

                    <Show when={isReplying() && canEdit()}>
                      <div class="ph-no-capture">
                        <Show when={!hasReplies()}>
                          <Thread.ReplyAuthor
                            userId={replyUserId()}
                            displayName={displayName()}
                          />
                        </Show>
                        <div
                          ref={replyInputContainerRef}
                          class="relative pt-2"
                          style={{ 'margin-left': replyInputOffsetX }}
                        >
                          <ThreadReplyInputConnector />
                          <DiscussionInput
                            input={{ mode: 'reply', placeholder: 'Reply...' }}
                            onSend={handleReply}
                            onClose={() => {
                              setIsReplying(false);
                            }}
                            onReady={(handle) => {
                              replyInputHandle = handle;
                            }}
                          />
                        </div>
                      </div>
                    </Show>

                    <Show when={!isReplying() && canEdit()}>
                      <Thread.ActionsFooter>
                        <Thread.ReplyButton
                          getFocusTarget={() =>
                            replyInputContainerRef?.querySelector<HTMLElement>(
                              '[contenteditable]'
                            ) ?? null
                          }
                          onClick={() => setIsReplying(true)}
                          aria-label="Reply"
                        />
                      </Thread.ActionsFooter>
                    </Show>
                  </Thread.RepliesContainer>
                </div>
              </Show>
            </Thread.Row>
          </div>
        );
      }}
    </Show>
  );
}

function DiscussionMessageView(props: {
  comment: DiscussionComment;
  actions: MessageActions;
  editingId: string | null;
  onEditSave: (snapshot: InputSnapshot) => void;
  onEditCancel: () => void;
  isHighlighted?: boolean;
}) {
  const isEditing = () => props.editingId === props.comment.id;
  const messageData = () => discussionCommentToMessageData(props.comment);

  let containerRef: HTMLDivElement | undefined;
  onMount(() => {
    if (props.isHighlighted) {
      containerRef?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  return (
    <div ref={containerRef}>
      <Show
        when={!isEditing()}
        fallback={
          <DiscussionInput
            input={{
              mode: 'reply',
              placeholder: 'Edit comment...',
              value: props.comment.text,
            }}
            onSend={props.onEditSave}
            onClose={() => {
              props.onEditCancel();
            }}
          />
        }
      >
        <Message.Root
          message={messageData()}
          actions={props.actions}
          highlighted={props.isHighlighted}
        >
          <Message.Layout class="pt-(--regular-message-padding-t)">
            <Message.Slot placement="icon">
              <Message.SenderIcon />
            </Message.Slot>
            <Message.Slot
              placement="header"
              class="flex items-center gap-1 min-w-0 w-full"
            >
              <Message.SenderName />
              <Message.EditedIndicator />
              <div class="grow shrink-0 min-w-0 flex justify-end group-hover/message:absolute group-hover/message:right-1 group-hover/message:-top-9 group-hover/message:p-1">
                <Message.Timestamp
                  class="ml-auto shrink-0"
                  format="dateAndTime"
                />
              </div>
            </Message.Slot>
            <Message.Slot placement="content" class="ph-no-capture">
              <Message.Content />
            </Message.Slot>
            <Message.ActionMenu />
          </Message.Layout>
        </Message.Root>
      </Show>
    </div>
  );
}
