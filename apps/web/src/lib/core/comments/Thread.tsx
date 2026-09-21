import { URL_PARAMS as MD_URL_PARAMS } from '@block-md/constants';
import { ChannelInput } from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createTheme } from '@core/component/LexicalMarkdown/theme';
import { MessageThreadById } from '@core/messages/MessageThread';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useContacts } from '@queries/contacts/contacts';
import { Layer } from '@ui';
import type { EditorThemeClasses } from 'lexical';
import {
  type Accessor,
  createContext,
  onCleanup,
  onMount,
  Show,
  useContext,
} from 'solid-js';
import {
  type CommentId,
  type CommentOperations,
  DRAFT_THREAD_ID,
  type Layout,
  type Root,
  type ThreadId,
} from './commentType';
import { MeasureContainer } from './MeasureContainer';

export const baseCommentTheme = createTheme({
  root: 'text-base',
  text: {
    base: 'select-text',
  },
});

export const threadMeasureContainerId = (
  documentId: string,
  threadId: ThreadId
) => `comment-measure-container-${documentId}-${threadId}`;

export type CommentsContextType = {
  setActiveThread: (threadId: ThreadId | null) => void;
  setThreadHeight: (threadId: ThreadId, height: number) => void;
  canComment: Accessor<boolean>;
  isDocumentOwner: Accessor<boolean>;
  commentOperations: CommentOperations;
  documentId: string;
  documentType: 'md' | 'task' | 'snippet' | 'skill' | 'pdf';
  highlightedCommentId: Accessor<CommentId | null>;
  /**
   * When set (the touch drawer), messages report their inline-edit state so
   * the host can hide its pinned reply composer while an edit is open.
   */
  setMessageEditing?: (commentId: CommentId, editing: boolean) => void;
};

export const CommentsContext = createContext<CommentsContextType>({
  setActiveThread: () => {},
  setThreadHeight: () => {},
  canComment: () => false,
  isDocumentOwner: () => false,
  commentOperations: { createComment: () => Promise.resolve(null) },
  documentId: '',
  documentType: 'md',
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
};

/**
 * The content of a comment thread: the shared message thread rooted at the
 * comment, or the new-comment composer for a draft. Positioning-agnostic —
 * `Thread` wraps it in the floating margin card, and the touch comment drawer
 * renders it directly.
 */
export function ThreadBody(props: ThreadBodyProps) {
  const context = useContext(CommentsContext);
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
              const created = await context.commentOperations.createComment({
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
              { type: context.documentType, id: context.documentId },
              { [MD_URL_PARAMS.commentId]: message.id }
            )
          }
        />
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
