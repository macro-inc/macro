import { buildChannelMessageListMeta } from '@channel/Channel/message-list-meta';
import type { InputSnapshot } from '@channel/Input/types';
import type { ChannelMessageListMeta } from '@channel/Message/list-meta';
import { Message } from '@channel/Message/Message';
import type { MessageActions } from '@channel/Message/types';
import { buildThreadReplyListMeta } from '@channel/Thread/reply-list-meta';
import { Thread } from '@channel/Thread/Thread';
import { ThreadReplyInputConnector } from '@channel/Thread/ThreadReplyInputConnector';
import { ThreadReplyRail } from '@channel/Thread/ThreadReplyRail';
import { channelReplyInputOffsetX } from '@channel/Thread/utils/thread-rail-geometry';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { getDisplayName, tryMacroId } from '@core/user';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
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
  const [mountedCommentsVersion, setMountedCommentsVersion] = createSignal(0);
  const mountedComments = new Map<string, HTMLElement>();
  let scrolledTarget: { commentId: string; revision: unknown } | undefined;

  // Deep-linking to a comment expands the discussion.
  createEffect(() => {
    if (source.targetCommentId() !== null) setIsExpanded(true);
  });

  const registerMountedComment = (commentId: string, element: HTMLElement) => {
    mountedComments.set(commentId, element);
    setMountedCommentsVersion((version) => version + 1);
  };

  const unregisterMountedComment = (
    commentId: string,
    element: HTMLElement
  ) => {
    if (mountedComments.get(commentId) === element) {
      mountedComments.delete(commentId);
      setMountedCommentsVersion((version) => version + 1);
    }
  };

  createEffect(() => {
    const targetCommentId = source.targetCommentId();
    const targetRevision = source.targetRevision?.() ?? targetCommentId;
    if (!targetCommentId) return;

    const currentThreads = source.threads();
    const targetThread = currentThreads.find((thread) =>
      thread.comments.some((comment) => comment.id === targetCommentId)
    );
    if (!targetThread) return;

    setIsExpanded(true);
    mountedCommentsVersion();

    const target = mountedComments.get(targetCommentId);
    if (!target) return;
    if (
      scrolledTarget?.commentId === targetCommentId &&
      Object.is(scrolledTarget.revision, targetRevision)
    ) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      scrolledTarget = {
        commentId: targetCommentId,
        revision: targetRevision,
      };
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    onCleanup(() => {
      cancelAnimationFrame(frame);
    });
  });

  let newThreadInputHandle: { clear: () => void } | undefined;

  const rootMetaById = createMemo(() => {
    const messages = source.threads().flatMap((thread) => {
      const root = thread.comments[0];
      if (!root) return [];
      const message = discussionCommentToApiChannelMessage(root);
      message.thread.reply_count = thread.comments.length - 1;
      return [message];
    });
    const metaById = buildChannelMessageListMeta(messages, () => false, true);

    return metaById;
  });

  const handleCreateThread = async (snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    await source.createThread(text, snapshot.mentions);
    newThreadInputHandle?.clear();
  };

  return (
    <section class="mt-3 pb-12">
      <div class="flex items-center gap-2">
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
                {(thread) => {
                  const root = () => thread.comments[0];
                  const listMeta = () =>
                    root() ? rootMetaById()[root()!.id] : undefined;
                  return (
                    <DiscussionThreadView
                      thread={thread}
                      listMeta={listMeta()}
                      onCommentMount={registerMountedComment}
                      onCommentCleanup={unregisterMountedComment}
                    />
                  );
                }}
              </For>
            </div>

            <Show when={source.canEdit()}>
              <div class="mt-4">
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

export function DiscussionThreadView(props: {
  thread: ViewThread;
  listMeta?: ChannelMessageListMeta;
  onCommentMount?: (commentId: string, element: HTMLElement) => void;
  onCommentCleanup?: (commentId: string, element: HTMLElement) => void;
}) {
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
  const replyMetaById = createMemo(() =>
    buildThreadReplyListMeta(
      replies().map(discussionCommentToApiChannelMessage)
    )
  );
  const threadId = () => props.thread.id;

  const replyUserId = () => source.currentUserId() ?? root()?.authorId ?? '';
  const macroId = () => tryMacroId(replyUserId());
  const displayName = () => getDisplayName(macroId());

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
            <Thread.Row
              message={rootMessageData()}
              listMeta={props.listMeta}
              showDividers={false}
            >
              <div class="relative">
                <Thread.RootRail
                  visible={hasReplies() || isReplying()}
                  grouped={props.listMeta?.isGroupedWithPrevious}
                />
                <DiscussionMessageView
                  comment={rootComment()}
                  grouped={props.listMeta?.isGroupedWithPrevious}
                  actions={makeActions(rootComment(), true)}
                  editingId={editingId()}
                  onEditSave={(snapshot) => handleEdit(rootComment(), snapshot)}
                  onEditCancel={() => setEditingId(null)}
                  isHighlighted={source.targetCommentId() === rootComment().id}
                  onMount={props.onCommentMount}
                  onCleanup={props.onCommentCleanup}
                />
              </div>

              <Show when={hasReplies() || isReplying()}>
                <div class="relative w-full">
                  <Thread.ReplyRailDecorations />
                  <Thread.RepliesContainer>
                    <For each={replies()}>
                      {(reply) => {
                        const meta = () => replyMetaById()[reply.id];
                        return (
                          <div class="relative">
                            <ThreadReplyRail
                              grouped={meta()?.isGroupedWithPrevious}
                            />
                            <DiscussionMessageView
                              comment={reply}
                              grouped={meta()?.isGroupedWithPrevious}
                              actions={makeActions(reply, false)}
                              editingId={editingId()}
                              onEditSave={(snapshot) =>
                                handleEdit(reply, snapshot)
                              }
                              onEditCancel={() => setEditingId(null)}
                              isHighlighted={
                                source.targetCommentId() === reply.id
                              }
                              onMount={props.onCommentMount}
                              onCleanup={props.onCommentCleanup}
                            />
                          </div>
                        );
                      }}
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
                          style={{ 'margin-left': channelReplyInputOffsetX }}
                        >
                          <Show when={hasReplies()}>
                            <ThreadReplyInputConnector rail="thread" />
                          </Show>
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
                  <Show when={!isReplying() && canEdit() && hasReplies()}>
                    <Thread.TerminalRail />
                  </Show>
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
  grouped?: boolean;
  onMount?: (commentId: string, element: HTMLElement) => void;
  onCleanup?: (commentId: string, element: HTMLElement) => void;
}) {
  const isEditing = () => props.editingId === props.comment.id;
  const messageData = () => discussionCommentToMessageData(props.comment);

  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!containerRef) return;
    props.onMount?.(props.comment.id, containerRef);
    onCleanup(() => {
      if (!containerRef) return;
      props.onCleanup?.(props.comment.id, containerRef);
    });
  });

  return (
    <div ref={containerRef}>
      <Message.Root
        message={messageData()}
        actions={props.actions}
        selected={props.isHighlighted}
      >
        <Message.Layout
          class={props.grouped ? undefined : 'pt-(--regular-message-padding-t)'}
        >
          <Message.Slot placement="icon">
            <Message.SenderIcon hidden={props.grouped} />
          </Message.Slot>
          <Show when={!props.grouped}>
            <Message.Slot
              placement="header"
              class="flex items-baseline gap-1 min-w-0"
            >
              <Message.SenderName />
              <Message.Timestamp class="shrink-0" format="dateAndTime" />
              <Message.EditedIndicator class="shrink-0" />
            </Message.Slot>
          </Show>
          <Message.Slot placement="content" class="ph-no-capture">
            <Show when={isEditing()} fallback={<Message.Content />}>
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
            </Show>
          </Message.Slot>
          <Show when={!isEditing()}>
            <Message.ActionMenu />
          </Show>
        </Message.Layout>
      </Message.Root>
    </div>
  );
}
