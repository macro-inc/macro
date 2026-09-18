import { URL_PARAMS as MD_URL_PARAMS } from '@block-md/constants';
import { ChannelInput } from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { useBlockAliasedName } from '@core/block';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createTheme } from '@core/component/LexicalMarkdown/theme';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { MessageThreadById } from '@core/messages/MessageThread';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useContacts } from '@queries/contacts/contacts';
import { Layer } from '@ui';
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
};

/**
 * The content of a comment thread: the root comment with its replies and the
 * reply input, or the new-comment composer for a draft. Positioning-agnostic —
 * `Thread` wraps it in the floating margin card, and the touch comment drawer
 * renders it directly.
 */
export function ThreadBody(props: ThreadBodyProps) {
  // PDF flag-on discussions are deferred, so PDF stays on the legacy path even
  // when the flag is on; only markdown documents use the message thread.
  const blockName = useBlockAliasedName();
  return isFeatureEnabled(enableUnifiedDocumentDiscussions) &&
    blockName !== 'pdf' ? (
    <MessageThreadBody {...props} />
  ) : (
    <LegacyThreadBody {...props} />
  );
}

/** Document threads render the shared message thread; a draft composes its root. */
function MessageThreadBody(props: ThreadBodyProps) {
  const context = useContext(CommentsContext);
  const blockName = useBlockAliasedName();
  // Workspace users for @-mentions, matching the legacy comment composer.
  const participants = useContacts();
  const parent = () => ({ type: 'document' as const, id: context.documentId });
  const targetId = () => {
    const highlighted = context.highlightedCommentId();
    return typeof highlighted === 'string' ? highlighted : null;
  };
  return (
    <StaticMarkdownContext theme={props.theme ?? baseCommentTheme}>
      <Show
        when={!props.comment.isNew}
        fallback={
          <ChannelInput
            parent={parent()}
            participants={participants}
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
        <MessageThreadById
          parent={parent()}
          rootId={String(props.comment.threadId)}
          canWrite={context.canComment()}
          canManage={context.isDocumentOwner()}
          hideReplyInput={props.hideReplyInput}
          onEditingChange={context.setMessageEditing}
          targetId={targetId()}
          buildLink={(message) =>
            buildSimpleEntityUrl(
              { type: blockName, id: context.documentId },
              { [MD_URL_PARAMS.commentId]: message.id }
            )
          }
        />
      </Show>
    </StaticMarkdownContext>
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
  ref?: (el: HTMLDivElement) => void;
  width?: number;
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
      forceWidth={props.width}
      transition={false}
    >
      <Layer depth={2}>
        <div
          data-comment-thread
          // note: pdf-pointer-event-reset is a strange one-off class that mostly normalizes
          // pointer-events: none vs. all inside the .pdfOverlayInner div.
          class="shrink-0 border border-edge bg-surface p-2 shadow-md rounded-xl shadow-drop-shadow portal-scope pointer-events-auto pdf-pointer-event-reset"
          classList={{
            'transition-transform duration-100': true,
            '-translate-x-8': props.isActive,
          }}
          style={{
            width: props.width ? `${props.width}px` : 'auto',
          }}
          ref={props.ref}
        >
          <ThreadBody
            comment={props.comment}
            isActive={props.isActive}
            theme={props.theme}
          />
        </div>
      </Layer>
    </MeasureContainer>
  );
}
