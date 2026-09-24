import { URL_PARAMS as MD_URL_PARAMS } from '@block-md/constants';
import { ChannelInput } from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createTheme } from '@core/component/LexicalMarkdown/theme';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { UserIcon } from '@core/component/UserIcon';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { MessageThreadById } from '@core/messages/MessageThread';
import { buildSimpleEntityUrl } from '@core/util/url';
import { markdownToPlainText } from '@macro-inc/lexical-core';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import Check from '@phosphor/check.svg';
import CheckCircle from '@phosphor/check-circle.svg';
import { usePatchThreadMutation } from '@queries/messages/mutations';
import { Button, Layer } from '@ui';
import type { EditorThemeClasses } from 'lexical';
import {
  type Accessor,
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Signal,
  useContext,
} from 'solid-js';
import { getAndClearCommentMentions } from '.';
import { Comment, CommentReply } from './Comment';
import {
  type CommentId,
  type CommentOperations,
  DRAFT_THREAD_ID,
  type Layout,
  type MessageCommentOperations,
  type Reply,
  type Root,
  type ThreadId,
} from './commentType';
import { EditInput, NewReplyInput } from './Inputs';
import { MeasureContainer } from './MeasureContainer';

type SoftSetEdit = {
  action: 'soft';
  editing: boolean;
};

type HardSetEdit = {
  action: 'hard';
  editing: boolean;
};

type SetText = {
  action: 'text';
  val: string;
};

export const baseCommentTheme = createTheme({
  root: 'text-base',
  text: {
    base: 'select-text',
  },
});

type Action = SoftSetEdit | HardSetEdit | SetText;

export const threadMeasureContainerId = (
  documentId: string,
  threadId: ThreadId
) => `comment-measure-container-${documentId}-${threadId}`;

export const ThreadContext = createContext<{
  mentionsSignal: Signal<UserMentionRecord[]>;
}>({
  mentionsSignal: [() => [], () => {}],
});

export type CommentsContextType = {
  setActiveThread: (threadId: ThreadId | null) => void;
  setThreadHeight: (threadId: ThreadId, height: number) => void;
  canComment: Accessor<boolean>;
  isDocumentOwner: Accessor<boolean>;
  commentOperations: CommentOperations;
  /** Present when the document reads and writes comments through the shared message API. */
  messageOperations?: MessageCommentOperations;
  getCommentById: (id: CommentId) => Root | Reply | undefined;
  documentId: string;
  documentType: 'md' | 'task' | 'snippet' | 'skill' | 'pdf';
  ownedComment: (id: CommentId) => boolean;
  inComment: boolean;
  highlightedCommentId: Accessor<CommentId | null>;
  /**
   * When set (the touch drawer), messages report their inline-edit state so
   * the host can hide its pinned reply composer while an edit is open.
   */
  setMessageEditing?: (commentId: CommentId, editing: boolean) => void;
};

/** Legacy operations for a document whose comments no longer go through the annotation endpoints. */
export const noopCommentOperations: CommentOperations = {
  createComment: () => Promise.resolve(null),
  deleteComment: () => Promise.resolve(false),
  updateComment: () => Promise.resolve(false),
};

export const CommentsContext = createContext<CommentsContextType>({
  setActiveThread: () => {},
  setThreadHeight: () => {},
  canComment: () => false,
  isDocumentOwner: () => false,
  commentOperations: noopCommentOperations,
  getCommentById: (_id) => undefined,
  documentId: '',
  documentType: 'md',
  ownedComment: () => false,
  inComment: false,
  highlightedCommentId: () => null,
});

type ThreadBodyProps = {
  comment: Root;
  isActive: boolean;
  theme?: EditorThemeClasses;
  /**
   * Suppress the in-thread reply input — the touch drawer pins its own
   * composer at the drawer bottom instead.
   */
  hideReplyInput?: boolean;
  /**
   * Render each message's actions as an always-visible ellipsis dropdown
   * instead of hover-revealed buttons (the touch drawer has no hover).
   */
  actionsDropdown?: boolean;
  /**
   * The host already draws a card — the floating margin thread. A draft's
   * composer drops its own card chrome so it does not read as a box inside a
   * box. The touch drawer leaves this off: there the composer sits on the
   * drawer body and its card is the only one.
   */
  flatComposer?: boolean;
};

/**
 * The content of a comment thread: the root comment with its replies and the
 * reply input, or the new-comment composer for a draft. Positioning-agnostic —
 * `Thread` wraps it in the floating margin card, and the touch comment drawer
 * renders it directly.
 */
export function ThreadBody(props: ThreadBodyProps) {
  const context = useContext(CommentsContext);
  // A PDF picks its comment store once, when its annotations load, and passes
  // message operations exactly when it chose the message API.
  const unified =
    context.documentType === 'pdf'
      ? context.messageOperations != null
      : isFeatureEnabled(enableUnifiedDocumentDiscussions);
  return unified ? (
    <MessageThreadBody {...props} />
  ) : (
    <LegacyThreadBody {...props} />
  );
}

/** Document threads render the shared message thread; a draft composes its root. */
function MessageThreadBody(props: ThreadBodyProps) {
  const context = useContext(CommentsContext);
  const parent = () => ({ type: 'document' as const, id: context.documentId });
  const targetId = () => {
    const highlighted = context.highlightedCommentId();
    return typeof highlighted === 'string' ? highlighted : null;
  };
  const patchThread = usePatchThreadMutation();
  const resolved = () => !!props.comment.resolved;
  const setResolved = (value: boolean) =>
    patchThread.mutate({
      parent: parent(),
      rootId: String(props.comment.threadId),
      patch: { resolved: value },
    });
  // A resolved thread folds to one line unless it is the active thread (a
  // comment link activates its thread, so linked threads open too).
  const collapsed = () => resolved() && !props.isActive;

  return (
    <StaticMarkdownContext theme={props.theme ?? baseCommentTheme}>
      <Show
        when={!props.comment.isNew}
        fallback={
          <ChannelInput
            parent={parent()}
            flat={props.flatComposer}
            input={{ mode: 'reply', placeholder: 'Leave a comment...' }}
            onClose={() => context.setActiveThread(null)}
            onSend={async (snapshot) => {
              const { thread_id: _threadId, ...message } =
                buildPostMessageSendPayload({ snapshot }).message;
              const created = await context.messageOperations?.createComment({
                ...message,
                threadId: DRAFT_THREAD_ID,
              });
              // Throw on failure so the draft composer is not cleared and the
              // comment can be retried (createComment resolves null, not rejects).
              if (!created) throw new Error('Failed to post comment');
            }}
          />
        }
      >
        <Show
          when={!collapsed()}
          fallback={
            <ResolvedThreadSummary
              comment={props.comment}
              onOpen={() => context.setActiveThread(props.comment.threadId)}
            />
          }
        >
          <MessageThreadById
            parent={parent()}
            rootId={String(props.comment.threadId)}
            canWrite={context.canComment()}
            monorail
            hideReplyInput={props.hideReplyInput}
            onEditingChange={context.setMessageEditing}
            targetId={targetId()}
            buildLink={(message) =>
              buildSimpleEntityUrl(
                { type: context.documentType, id: context.documentId },
                { [MD_URL_PARAMS.commentId]: message.id }
              )
            }
          />
          <Show when={resolved()}>
            <div class="mt-1 flex items-center gap-1.5 text-xs text-success">
              <CheckCircle class="size-3.5 shrink-0" />
              <span class="flex-1">Resolved</span>
              <Show when={context.canComment()}>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setResolved(false)}
                >
                  <ArrowCounterClockwise />
                  Reopen
                </Button>
              </Show>
            </div>
          </Show>
          <Show when={!resolved() && props.isActive && context.canComment()}>
            <div class="mt-1 flex justify-end">
              <Button
                size="xs"
                variant="ghost"
                onClick={(e: MouseEvent) => {
                  // The card's container re-activates the thread on click.
                  e.stopPropagation();
                  setResolved(true);
                  context.setActiveThread(null);
                }}
              >
                <Check />
                Resolve
              </Button>
            </div>
          </Show>
        </Show>
      </Show>
    </StaticMarkdownContext>
  );
}

/** The one-line stand-in for a resolved thread: who started it and how it began. */
function ResolvedThreadSummary(props: { comment: Root; onOpen: () => void }) {
  const preview = createMemo(() =>
    markdownToPlainText(props.comment.text).trim().replace(/\s+/g, ' ')
  );
  const replyCount = () =>
    props.comment.replyCount ?? props.comment.children.length;
  return (
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 text-left text-xs text-ink-extra-muted hover:bg-hover"
      aria-label="Show resolved comment"
      onClick={(e) => {
        e.stopPropagation();
        props.onOpen();
      }}
    >
      <CheckCircle class="size-4 shrink-0 text-success" />
      <UserIcon
        id={props.comment.owner}
        size="sm"
        suppressClick
        isDeleted={false}
      />
      <span class="min-w-0 flex-1 truncate">{preview()}</span>
      <Show when={replyCount() > 0}>
        <span class="shrink-0 tabular-nums">
          {`${replyCount()} ${replyCount() > 1 ? 'replies' : 'reply'}`}
        </span>
      </Show>
    </button>
  );
}

function LegacyThreadBody(props: ThreadBodyProps) {
  const {
    canComment,
    commentOperations,
    setActiveThread,
    ownedComment,
    highlightedCommentId,
  } = useContext(CommentsContext);

  const [textValue, setTextValue] = createSignal('');
  const [isEditingNewReply, setIsEditingNewReply] = createSignal(false);

  // Function to handle state updates
  const dispatch = (action: Action) => {
    switch (action.action) {
      case 'soft':
        setIsEditingNewReply((prev) => (textValue() ? prev : action.editing));
        break;
      case 'hard':
        setIsEditingNewReply(action.editing);
        break;
      case 'text':
        setTextValue(action.val);
        break;
    }
  };

  const showNewReplyInput = createMemo(() => {
    if (!canComment()) return false;
    return props.isActive || isEditingNewReply();
  });

  // when thread is not active and new reply input is open, close the new reply input if empty
  createEffect(() => {
    if (!props.isActive) {
      dispatch({ action: 'soft', editing: false });
    }
  });

  const [allRepliesVisible, setAllRepliesVisible] =
    createSignal<boolean>(false);

  const replyIds = createMemo(() => props.comment.children);
  const lastReplyId = createMemo(() => replyIds().at(-1));
  const collapseRepliesList = createMemo(
    () => replyIds().length > 0 && !allRepliesVisible()
  );
  const collapsedCount = createMemo(() =>
    collapseRepliesList() ? replyIds().length - 1 : 0
  );

  // when expanding to show all replies then clicking away from
  // thread (i.e. making it inactive), collapse the replies list
  createEffect(() => {
    if (props.isActive || !allRepliesVisible()) return;
    setAllRepliesVisible(false);
  });

  // expand all replies if we're navigating to a specific reply via URL
  createEffect(() => {
    const hId = highlightedCommentId();
    if (hId === null) return;
    if (replyIds().includes(hId)) {
      setAllRepliesVisible(true);
    }
  });

  const mentionsSignal = createSignal<UserMentionRecord[]>([]);

  return (
    <ThreadContext.Provider value={{ mentionsSignal }}>
      <StaticMarkdownContext theme={props.theme ?? baseCommentTheme}>
        <Show
          when={!props.comment.isNew}
          fallback={
            <EditInput
              textValue={''}
              handleCancel={() => {}}
              onSend={(content: string) => {
                if (content.trim() === '') return;
                // NOTE: we need the server to return the thread id first
                return commentOperations.createComment({
                  threadId: props.comment.threadId,
                  text: content,
                  mentions: getAndClearCommentMentions(mentionsSignal),
                });
              }}
              isNewThread
            />
          }
        >
          <div
            on:click={() => {
              dispatch({ action: 'soft', editing: false });
            }}
          >
            <Comment
              comment={props.comment}
              isOwned={ownedComment(props.comment.id)}
              isActive={props.isActive}
              isThreaded={replyIds().length > 0}
              actionsDropdown={props.actionsDropdown}
            >
              <Show when={replyIds().length > 0 && lastReplyId()}>
                <Show when={collapsedCount() > 0}>
                  <button
                    class="text-xs text-ink-extra-muted hover:bg-hover text-left ml-5 rounded p-1 px-2 mb-2"
                    on:click={() => {
                      batch(() => {
                        setActiveThread(props.comment.threadId);
                        setAllRepliesVisible(true);
                      });
                    }}
                  >
                    {`Show ${collapsedCount()} ${collapsedCount() > 1 ? 'replies' : 'reply'}`}
                  </button>
                </Show>
              </Show>
            </Comment>
            {
              <For each={replyIds()}>
                {(replyId) => {
                  const hide = () =>
                    collapseRepliesList() && replyId !== lastReplyId();
                  return (
                    <CommentReply
                      hide={hide()}
                      replyId={replyId}
                      isOwned={ownedComment(replyId)}
                      isActive={props.isActive}
                      threadId={props.comment.threadId}
                      isThreaded={replyId !== lastReplyId()}
                      actionsDropdown={props.actionsDropdown}
                      deleteReply={() =>
                        commentOperations.deleteComment({
                          commentId: replyId,
                        })
                      }
                      updateReply={(content) => {
                        return Promise.all([
                          commentOperations.updateComment(replyId, {
                            text: content,
                            threadId: props.comment.threadId,
                            mentions:
                              getAndClearCommentMentions(mentionsSignal),
                          }),
                        ]);
                      }}
                    />
                  );
                }}
              </For>
            }
          </div>
          <Show when={showNewReplyInput() && !props.hideReplyInput}>
            <div class="mt-2">
              <NewReplyInput
                textValue={textValue()}
                setTextValue={(val) => dispatch({ action: 'text', val })}
                createReply={(content) => {
                  if (content.trim() === '') return;
                  dispatch({ action: 'hard', editing: false });
                  return commentOperations.createComment({
                    threadId: props.comment.threadId,
                    text: content,
                    mentions: getAndClearCommentMentions(mentionsSignal),
                  });
                }}
                isEditing={isEditingNewReply()}
                setEditing={(editing) => dispatch({ action: 'hard', editing })}
              />
            </div>
          </Show>
        </Show>
      </StaticMarkdownContext>
    </ThreadContext.Provider>
  );
}

export function Thread(props: {
  comment: Root;
  layout: Layout;
  isActive: boolean;
  theme?: EditorThemeClasses;
  maxHeight?: number;
  handleMouseDown?: (e: MouseEvent) => void;
}) {
  let measureContainerRef!: HTMLDivElement;

  onMount(() => {
    if (!props.handleMouseDown) return;
    const handleMouseDown = props.handleMouseDown;
    measureContainerRef.addEventListener('mousedown', handleMouseDown);
    onCleanup(() => {
      measureContainerRef.removeEventListener('mousedown', handleMouseDown);
    });
  });

  return (
    <MeasureContainer
      alignment="right"
      alignmentOffset={0}
      ref={measureContainerRef}
      top={props.layout.calculatedYPos}
      threadId={props.comment.threadId}
      maxHeight={props.maxHeight}
      isActive={props.isActive}
      transition={false}
    >
      <ThreadCard
        comment={props.comment}
        isActive={props.isActive}
        theme={props.theme}
        shifted={props.isActive}
      />
    </MeasureContainer>
  );
}

/** The floating card around a thread, placed by the margin or by a popover. */
export function ThreadCard(props: {
  comment: Root;
  isActive: boolean;
  theme?: EditorThemeClasses;
  width?: number;
  /** Nudge the active card toward the text it annotates. */
  shifted?: boolean;
}) {
  return (
    <Layer depth={2}>
      <div
        data-comment-thread
        // note: pdf-pointer-event-reset is a strange one-off class that mostly normalizes
        // pointer-events: none vs. all inside the .pdfOverlayInner div.
        class="shrink-0 border border-edge bg-surface p-2 shadow-md rounded-xl shadow-drop-shadow portal-scope pointer-events-auto pdf-pointer-event-reset"
        classList={{
          'transition-transform duration-100': true,
          '-translate-x-8': props.shifted,
        }}
        style={{
          width: props.width ? `${props.width}px` : 'auto',
        }}
      >
        <ThreadBody
          comment={props.comment}
          isActive={props.isActive}
          theme={props.theme}
          flatComposer
        />
      </div>
    </Layer>
  );
}
