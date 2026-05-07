import type { InputSnapshot } from '@channel/Input/types';
import { Message } from '@channel/Message/Message';
import type {
  MessageActionContext,
  MessageActions,
} from '@channel/Message/types';
import { Thread } from '@channel/Thread/Thread';
import { ThreadRail } from '@channel/Thread/ThreadRail';
import { ThreadReplyInputConnector } from '@channel/Thread/ThreadReplyInputConnector';
import { replyInputOffsetX } from '@channel/Thread/utils/thread-rail-geometry';
import { useBlockId } from '@core/block';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { useUrlParams } from '@core/component/ParamsProvider';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { useCanEdit } from '@core/signal/permissions';
import { tryMacroId, useDisplayName } from '@core/user';
import { buildSimpleEntityUrl } from '@core/util/url';
import CaretDown from '@icon/bold/caret-down-bold.svg';
import CaretRight from '@icon/bold/caret-right-bold.svg';
import type { Comment } from '@service-storage/generated/schemas/comment';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import type { CreateCommentRequestMentions } from '@service-storage/generated/schemas/createCommentRequestMentions';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';
import {
  commentToApiChannelMessage,
  commentToMessageData,
} from '../comments/discussionAdapter';
import {
  discussionThreads,
  sortComments,
  useCreateDiscussionReply,
  useCreateDiscussionThread,
  useDeleteDiscussionComment,
  useEditDiscussionComment,
} from '../comments/discussionResource';
import { URL_PARAMS } from '../constants';
import { DiscussionInput } from './DiscussionInput';

function buildCommentMentions(
  mentions: ItemMention[]
): CreateCommentRequestMentions | undefined {
  const userIds = mentions
    .filter((m) => m.itemType === 'user')
    .map((m) => m.itemId);

  if (userIds.length === 0) {
    return undefined;
  }

  return {
    mentionId: crypto.randomUUID(),
    users: userIds,
  };
}

export function TaskDiscussion() {
  const canEdit = useCanEdit();
  const createThread = useCreateDiscussionThread();
  const [isExpanded, setIsExpanded] = createSignal(true);

  const urlParams = useUrlParams(URL_PARAMS);
  const targetCommentId = createMemo(() => {
    const raw = urlParams.commentId();
    if (!raw) return null;
    const id = Number(raw);
    return isNaN(id) ? null : id;
  });

  createEffect(() => {
    if (targetCommentId() !== null) setIsExpanded(true);
  });

  let newThreadInputHandle: { clear: () => void } | undefined;

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded());
  };

  const handleCreateThread = async (snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    const mentions = buildCommentMentions(snapshot.mentions);
    await createThread(text, mentions);
    newThreadInputHandle?.clear();
  };

  return (
    <section class="mt-8 pb-12">
      <div class="flex items-center gap-2 pt-2">
        <div class="w-6 border-t border-edge-muted" />
        <button
          type="button"
          class="flex items-center gap-1 px-2 hover:opacity-70 transition-opacity"
          onClick={toggleExpanded}
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
              <For each={discussionThreads() ?? []}>
                {(thread) => (
                  <DiscussionThread
                    thread={thread}
                    targetCommentId={targetCommentId()}
                  />
                )}
              </For>
            </div>

            <Show when={canEdit()}>
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

function DiscussionThread(props: {
  thread: CommentThread;
  targetCommentId: number | null;
}) {
  const userId = useUserId();
  const canEdit = useCanEdit();
  const blockId = useBlockId();
  const createReply = useCreateDiscussionReply();
  const editComment = useEditDiscussionComment();
  const deleteComment = useDeleteDiscussionComment();

  const [isReplying, setIsReplying] = createSignal(false);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  let replyInputHandle: { clear: () => void } | undefined;
  let replyInputContainerRef: HTMLDivElement | undefined;

  const sorted = () => [...props.thread.comments].sort(sortComments);
  const root = () => sorted()[0];
  const replies = () => sorted().slice(1);
  const hasReplies = () => replies().length > 0;

  const threadId = () => props.thread.thread.threadId;

  const replyUserId = () => userId() ?? root()?.sender ?? root()?.owner ?? '';
  const macroId = () => tryMacroId(replyUserId());
  const [displayName] = useDisplayName(macroId());

  const isOwn = (comment: Comment) =>
    (comment.sender ?? comment.owner) === userId();

  const makeCopyLink =
    (comment: Comment): ((ctx: MessageActionContext) => Promise<void>) =>
    async () => {
      const params: Record<string, string> = {
        [URL_PARAMS.commentId]: String(comment.commentId),
      };
      try {
        const url = buildSimpleEntityUrl({ type: 'task', id: blockId }, params);
        await navigator.clipboard.writeText(url);
        toast.success('Link copied to clipboard');
      } catch {
        toast.failure('Could not copy link');
      }
    };

  const makeActions = (comment: Comment, isRoot: boolean): MessageActions => {
    const own = isOwn(comment);
    return {
      onReply: isRoot
        ? () => {
            setIsReplying(true);
          }
        : undefined,
      onEdit: own
        ? () => {
            setEditingId(comment.commentId);
          }
        : undefined,
      onDelete:
        own && canEdit()
          ? async () => {
              await deleteComment(comment.commentId, {});
            }
          : undefined,
      onCopyLink: makeCopyLink(comment),
    };
  };

  const handleReply = async (snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    const mentions = buildCommentMentions(snapshot.mentions);
    await createReply(text, threadId(), mentions);
    replyInputHandle?.clear();
    setIsReplying(false);
  };

  const handleEdit = async (comment: Comment, snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    await editComment(comment.commentId, {
      text,
      threadId: threadId(),
    });
    setEditingId(null);
  };

  return (
    <Show when={root()}>
      {(rootComment) => {
        const rootMessageData = () => commentToApiChannelMessage(rootComment());
        return (
          <div class="flex flex-col w-full gap-0">
            <Thread.Row message={rootMessageData()}>
              <DiscussionMessage
                comment={rootComment()}
                actions={makeActions(rootComment(), true)}
                editingId={editingId()}
                onEditSave={(snapshot) => handleEdit(rootComment(), snapshot)}
                onEditCancel={() => setEditingId(null)}
                isHighlighted={
                  props.targetCommentId === rootComment().commentId
                }
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
                          <DiscussionMessage
                            comment={reply}
                            actions={makeActions(reply, false)}
                            editingId={editingId()}
                            onEditSave={(snapshot) =>
                              handleEdit(reply, snapshot)
                            }
                            onEditCancel={() => setEditingId(null)}
                            isHighlighted={
                              props.targetCommentId === reply.commentId
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

function DiscussionMessage(props: {
  comment: Comment;
  actions: MessageActions;
  editingId: number | null;
  onEditSave: (snapshot: InputSnapshot) => void;
  onEditCancel: () => void;
  isHighlighted?: boolean;
}) {
  const isEditing = () => props.editingId === props.comment.commentId;
  const messageData = () => commentToMessageData(props.comment);

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
