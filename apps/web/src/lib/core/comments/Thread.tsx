import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createTheme } from '@core/component/LexicalMarkdown/theme';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { Layer } from '@ui';
import type { EditorThemeClasses } from 'lexical';
import {
  type Accessor,
  createContext,
  onCleanup,
  onMount,
  Show,
  type Signal,
  useContext,
} from 'solid-js';
import type { CommentOperations, Layout, Reply, Root } from './commentType';
import {
  DiscussionInput,
  DiscussionProvider,
  type DiscussionSource,
  DiscussionThreadView,
} from './discussion';
import {
  messageAttachments,
  messageMentions,
  messageToDiscussionComment,
} from './discussion/messageAdapter';
import { MeasureContainer } from './MeasureContainer';

export const baseCommentTheme = createTheme({
  root: 'text-sm',
  text: {
    base: 'select-text',
  },
});

export const threadMeasureContainerId = (
  documentId: string,
  threadId: string
) => `comment-measure-container-${documentId}-${threadId}`;

export const ThreadContext = createContext<{
  mentionsSignal: Signal<UserMentionRecord[]>;
}>({
  mentionsSignal: [() => [], () => {}],
});

export type CommentsContextType = {
  discussionSource?: DiscussionSource;
  setActiveThread: (threadId: string | null) => void;
  setThreadHeight: (threadId: string, height: number) => void;
  canComment: Accessor<boolean>;
  isDocumentOwner: Accessor<boolean>;
  commentOperations: CommentOperations;
  getCommentById: (id: string) => Root | Reply | undefined;
  documentId: string;
  ownedComment: (id: string) => boolean;
  inComment: boolean;
  highlightedCommentId: Accessor<string | null>;
  /**
   * When set (the touch drawer), messages report their inline-edit state so
   * the host can hide its pinned reply composer while an edit is open.
   */
  setMessageEditing?: (commentId: string, editing: boolean) => void;
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
  highlightedCommentId: () => null,
});

/**
 * The content of a comment thread: the root comment with its replies and the
 * reply input, or the new-comment composer for a draft. Positioning-agnostic —
 * `Thread` wraps it in the floating margin card, and the touch comment drawer
 * renders it directly.
 */
export function ThreadBody(props: {
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
}) {
  const context = useContext(CommentsContext);
  const viewThread = () => ({
    id: props.comment.threadId,
    ownerId: props.comment.owner,
    resolved: props.comment.resolved ?? false,
    comments: [
      props.comment,
      ...props.comment.children.map((id) => context.getCommentById(id)),
    ].flatMap((comment) =>
      comment?.message ? [messageToDiscussionComment(comment.message)] : []
    ),
  });
  return (
    <StaticMarkdownContext theme={props.theme ?? baseCommentTheme}>
      <Show
        when={!props.comment.isNew}
        fallback={
          <DiscussionInput
            input={{ mode: 'reply', placeholder: 'Leave a comment...' }}
            onClose={() => context.setActiveThread(null)}
            onSend={async (snapshot) => {
              await context.commentOperations.createComment({
                content: snapshot.value,
                thread_id: 'draft',
                mentions: messageMentions(snapshot.mentions),
                attachments: messageAttachments(snapshot.attachments),
              });
            }}
          />
        }
      >
        <Show when={context.discussionSource}>
          {(source) => (
            <DiscussionProvider source={source()}>
              <DiscussionThreadView
                thread={viewThread()}
                hideReplyInput={props.hideReplyInput}
                onEditingChange={context.setMessageEditing}
              />
            </DiscussionProvider>
          )}
        </Show>
      </Show>
    </StaticMarkdownContext>
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
