import { BozzyBracketInnerSibling } from '@core/component/BozzyBracket';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/component/menu/MentionsMenu';
import { createTheme } from '@core/component/LexicalMarkdown/theme';
import type { DocumentMentionLocation } from '@service-notification/client';
import { storageServiceClient } from '@service-storage/client';
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
import { Comment, CommentReply } from './Comment';
import type { CommentOperations, Layout, Reply, Root } from './commentType';
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
  root: 'text-sm',
  text: {
    base: 'select-text',
  },
});

type Action = SoftSetEdit | HardSetEdit | SetText;

export const threadMeasureContainerId = (
  documentId: string,
  threadId: number
) => `comment-measure-container-${documentId}-${threadId}`;

export const ThreadContext = createContext<{
  mentionsSignal: Signal<UserMentionRecord[]>;
  measureContainerEl: Accessor<HTMLElement | null>;
}>({
  mentionsSignal: [() => [], () => {}],
  measureContainerEl: () => null,
});

export type CommentsContextType = {
  setActiveThread: (threadId: number | null) => void;
  setThreadHeight: (threadId: number, height: number) => void;
  canComment: Accessor<boolean>;
  isDocumentOwner: Accessor<boolean>;
  commentOperations: CommentOperations;
  getCommentById: (id: number) => Root | Reply | undefined;
  documentId: string;
  ownedComment: (id: number) => boolean;
  inComment: boolean;
};
export const CommentsContext = createContext<CommentsContextType>({
  setActiveThread: () => {},
  setThreadHeight: () => {},
  canComment: () => false,
  isDocumentOwner: () => false,
  commentOperations: {
    createComment: () => Promise.resolve(null),
    deleteComment: () => Promise.resolve(false),
    updateComment: () => Promise.resolve(false),
  },
  getCommentById: (_id) => undefined,
  documentId: '',
  ownedComment: () => false,
  inComment: false,
});

export const sendMentions = (
  data: DocumentMentionLocation,
  mentionsSignal: Signal<UserMentionRecord[]>
) => {
  const [mentions, setMentions] = mentionsSignal;
  const mentions_ = mentions();
  setMentions([]);
  if (mentions_.length === 0) return;
  const aggregatedMention: UserMentionRecord = {
    documentId: mentions_[0].documentId,
    mentions: mentions_.flatMap((m) => m.mentions),
    metadata: {
      mention_id: mentions_[0].metadata.mention_id,
      location: data,
    },
  };
  return storageServiceClient.upsertUserMentions(aggregatedMention);
};

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

  const { canComment, commentOperations, setActiveThread, ownedComment } =
    useContext(CommentsContext);

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

  onMount(() => {
    if (!props.handleMouseDown) return;
    const handleMouseDown = props.handleMouseDown;
    measureContainerRef.addEventListener('mousedown', handleMouseDown);
    onCleanup(() => {
      measureContainerRef.removeEventListener('mousedown', handleMouseDown);
    });
  });

  const mentionsSignal = createSignal<UserMentionRecord[]>([]);

  return (
    <ThreadContext.Provider
      value={{
        mentionsSignal,
        measureContainerEl: () => measureContainerRef,
      }}
    >
      <StaticMarkdownContext theme={props.theme ?? baseCommentTheme}>
        <MeasureContainer
          alignment="right"
          alignmentOffset={0}
          ref={measureContainerRef}
          top={props.layout.calculatedYPos}
          threadId={props.comment.threadId}
          maxHeight={props.maxHeight}
          isActive={props.isActive}
          forceWidth={props.width}
          transition={true}
        >
          <div
            // note: pdf-pointer-event-reset is a strange one-off class that mostly normalizes
            // pointer-events: none vs. all inside the .pdfOverlayInner div.
            class="flex-shrink-0 bg-panel p-2 ring-1 ring-edge portal-scope pointer-events-auto pdf-pointer-event-reset"
            classList={{
              'transition-transform duration-100': true,
              '-translate-x-8': props.isActive,
            }}
            style={{
              width: props.width ? `${props.width}px` : 'auto',
            }}
            ref={props.ref}
          >
            <Show
              when={!props.comment.isNew}
              fallback={
                <EditInput
                  textValue={''}
                  handleCancel={() => {}}
                  onSend={(content: string) => {
                    if (content.trim() === '') return;
                    // NOTE: we need the server to return the thread id first
                    commentOperations
                      .createComment({
                        threadId: props.comment.threadId,
                        text: content,
                      })
                      .then((response) => {
                        if (!response) return;
                        sendMentions(
                          {
                            type: 'create-comment',
                            commentId: response.comments[0].commentId,
                            threadId: response.thread.threadId,
                            text: content,
                          },
                          mentionsSignal
                        );
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
                >
                  <Show when={replyIds().length > 0 && lastReplyId()}>
                    <Show when={collapsedCount() > 0}>
                      <button
                        class="text-xs text-ink-extra-muted font-mono hover:bg-hover hover-transition-bg text-left ml-5 p-1 mb-2"
                        on:click={() => {
                          batch(() => {
                            setActiveThread(props.comment.threadId);
                            setAllRepliesVisible(true);
                          });
                        }}
                      >
                        {`Show [ ${collapsedCount()} ] ${collapsedCount() > 1 ? 'replies' : 'reply'}`}
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
                          deleteReply={() =>
                            commentOperations.deleteComment({
                              commentId: replyId,
                            })
                          }
                          updateReply={(content) => {
                            Promise.all([
                              commentOperations.updateComment({
                                text: content,
                                commentId: replyId,
                              }),
                              sendMentions(
                                {
                                  type: 'edit-comment',
                                  commentId: replyId,
                                  threadId: props.comment.threadId,
                                  text: content,
                                },
                                mentionsSignal
                              ),
                            ]);
                          }}
                        />
                      );
                    }}
                  </For>
                }
              </div>
              <Show when={showNewReplyInput()}>
                <NewReplyInput
                  textValue={textValue()}
                  setTextValue={(val) => dispatch({ action: 'text', val })}
                  createReply={(content) => {
                    if (content.trim() === '') return;
                    dispatch({ action: 'hard', editing: false });
                    commentOperations
                      .createComment({
                        threadId: props.comment.threadId,
                        text: content,
                      })
                      .then((response) => {
                        if (!response) return;
                        sendMentions(
                          {
                            type: 'create-comment',
                            commentId:
                              response.comments[response.comments.length - 1]
                                .commentId,
                            threadId: props.comment.threadId,
                            text: content,
                          },
                          mentionsSignal
                        );
                      });
                  }}
                  isEditing={isEditingNewReply()}
                  setEditing={(editing) =>
                    dispatch({ action: 'hard', editing })
                  }
                />
              </Show>
            </Show>
          </div>
          <BozzyBracketInnerSibling
            classList={{
              'opacity-0': !props.isActive,
              'transition-transform duration-100': true,
              'scale-110': !props.isActive,
              'scale-100': props.isActive,
              '-translate-x-8': props.isActive,
            }}
          />
        </MeasureContainer>
      </StaticMarkdownContext>
    </ThreadContext.Provider>
  );
}
