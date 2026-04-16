import { useUserId } from '@core/context/user';
import { useCanEdit } from '@core/signal/permissions';
import { Message } from '@channel/Message/Message';
import { ChannelInput } from '@channel/Input/ChannelInput';
import { Thread } from '@channel/Thread/Thread';
import { ThreadRail } from '@channel/Thread/ThreadRail';
import { ThreadReplyInputConnector } from '@channel/Thread/ThreadReplyInputConnector';
import { replyInputOffsetX } from '@channel/Thread/utils/thread-rail-geometry';
import type { MessageActions } from '@channel/Message/types';
import type { InputSnapshot } from '@channel/Input/types';
import type { Comment } from '@service-storage/generated/schemas/comment';
import { createSignal, For, Show } from 'solid-js';
import {
  discussionThreads,
  sortComments,
  useCreateDiscussionThread,
  useCreateDiscussionReply,
  useEditDiscussionComment,
  useDeleteDiscussionComment,
} from '../comments/discussionResource';
import { commentToMessageData } from '../comments/discussionAdapter';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';

export function TaskDiscussion() {
  const canEdit = useCanEdit();
  const createThread = useCreateDiscussionThread();
  let newThreadInputHandle: { clear: () => void } | undefined;

  const handleCreateThread = async (snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    await createThread(text);
    newThreadInputHandle?.clear();
  };

  return (
    <section class="mt-8 pb-12">
      <div class="border-t border-edge-muted mb-4" />
      <h3 class="text-sm font-medium text-ink-muted mb-4">Activity</h3>

      <div class="flex flex-col gap-4">
        <For each={discussionThreads() ?? []}>
          {(thread) => <DiscussionThread thread={thread} />}
        </For>
      </div>

      <Show when={canEdit()}>
        <div class="mt-4">
          <ChannelInput
            input={{ mode: 'channel', placeholder: 'Leave a comment...' }}
            onSend={handleCreateThread}
            onReady={(handle) => {
              newThreadInputHandle = handle;
            }}
            autofocus={false}
          />
        </div>
      </Show>
    </section>
  );
}

function DiscussionThread(props: { thread: CommentThread }) {
  const userId = useUserId();
  const canEdit = useCanEdit();
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

  const isOwn = (comment: Comment) =>
    (comment.sender ?? comment.owner) === userId();

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
    };
  };

  const handleReply = async (snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    await createReply(text, threadId());
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
    <div class="discussion-thread">
      <Show when={root()}>
        {(rootComment) => (
          <div class="flex flex-col w-full">
            <DiscussionMessage
              comment={rootComment()}
              actions={makeActions(rootComment(), true)}
              editingId={editingId()}
              onEditSave={(snapshot) => handleEdit(rootComment(), snapshot)}
              onEditCancel={() => setEditingId(null)}
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
                          onEditSave={(snapshot) => handleEdit(reply, snapshot)}
                          onEditCancel={() => setEditingId(null)}
                        />
                      </div>
                    )}
                  </For>

                  <Show when={isReplying() && canEdit()}>
                    <div
                      ref={replyInputContainerRef}
                      class="relative pt-2"
                      style={{ 'margin-left': replyInputOffsetX }}
                    >
                      <ThreadReplyInputConnector />
                      <ChannelInput
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
          </div>
        )}
      </Show>
    </div>
  );
}

function DiscussionMessage(props: {
  comment: Comment;
  actions: MessageActions;
  editingId: number | null;
  onEditSave: (snapshot: InputSnapshot) => void;
  onEditCancel: () => void;
}) {
  const isEditing = () => props.editingId === props.comment.commentId;
  const messageData = () => commentToMessageData(props.comment);

  return (
    <Show
      when={!isEditing()}
      fallback={
        <ChannelInput
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
      <Message.Root message={messageData()} actions={props.actions}>
        <Message.Layout class="pt-(--regular-message-padding-t)">
          <Message.Slot placement="icon">
            <Message.SenderIcon />
          </Message.Slot>
          <Message.Slot
            placement="header"
            class="flex items-center gap-1 min-w-0"
          >
            <Message.SenderName />
            <Message.EditedIndicator />
            <Message.Timestamp class="ml-auto" />
          </Message.Slot>
          <Message.Slot placement="content" class="ph-no-capture">
            <Message.Content />
          </Message.Slot>
          <Message.Slot placement="actions">
            <Message.ActionMenu />
          </Message.Slot>
        </Message.Layout>
      </Message.Root>
    </Show>
  );
}
