import {
  commentView,
  DRAFT_THREAD_ID,
  type Root,
  type ThreadId,
} from '@core/comments/commentType';
import {
  CommentsContext,
  type CommentsContextType,
  ThreadCard,
} from '@core/comments/Thread';
import {
  newMessageId,
  useSendMessageMutation,
} from '@queries/messages/mutations';
import type { MessageListItem } from '@service-storage/messages';
import { type Accessor, For, Show } from 'solid-js';
import type {
  DocxComments,
  LocatedThread,
} from '../primitives/create-docx-comments';
import { DocxMarginLayout } from './DocxMarginLayout';

function toRoot(item: MessageListItem, anchorId: string): Root {
  return {
    ...commentView(item),
    rootId: item.id,
    threadId: item.id,
    anchorId,
    isNew: false,
    children: item.thread.preview.map((reply) => reply.id),
    replyCount: item.thread.reply_count,
    resolved: item.state.resolved,
  };
}

function draftRoot(markId: string, userId: string): Root {
  return {
    id: DRAFT_THREAD_ID,
    rootId: DRAFT_THREAD_ID,
    threadId: DRAFT_THREAD_ID,
    anchorId: markId,
    owner: userId,
    author: userId,
    text: '',
    createdAt: undefined,
    isNew: true,
    children: [],
  };
}

/**
 * Comment threads beside a DOCX, on the shared message store. Threads are
 * anchored by marks in the collaborative document; the margin lays out one
 * card per visible thread next to its text.
 */
export function DocxCommentMargin(props: {
  documentId: string;
  comments: DocxComments;
  /** The editor element; selection and clicks are read from it. */
  editorRoot: HTMLElement | undefined;
  /** Positioning parent: the margin scrolls with the document. */
  margin: HTMLElement | undefined;
  revision: Accessor<number>;
  canComment: Accessor<boolean>;
  isOwner: Accessor<boolean>;
  userId: Accessor<string | undefined>;
}) {
  const userId = props.userId;
  const send = useSendMessageMutation();
  const parent = () => ({ type: 'document' as const, id: props.documentId });

  const setActiveThread = (threadId: ThreadId | null) => {
    if (threadId === null || threadId === DRAFT_THREAD_ID) {
      if (threadId === null && props.comments.draft())
        props.comments.cancelDraft();
      else if (threadId === null) props.comments.setActive(null);
      return;
    }
    props.comments.setActive(String(threadId));
  };

  const context: CommentsContextType = {
    setActiveThread,
    setThreadHeight: () => {},
    canComment: props.canComment,
    isDocumentOwner: props.isOwner,
    documentId: props.documentId,
    documentType: 'write',
    highlightedCommentId: () => null,
    messageOperations: {
      createComment: async ({ threadId: _threadId, ...message }) => {
        const senderId = userId();
        if (!senderId) return null;
        const optimisticId = newMessageId();
        try {
          const created = await props.comments.commitDraft((draft) =>
            send.mutateAsync({
              parent: parent(),
              senderId,
              optimisticId,
              message: {
                ...message,
                anchor: {
                  type: 'markdown',
                  mark_id: draft.markId,
                  marked_text: draft.mark.text,
                },
              },
            })
          );
          props.comments.setActive(optimisticId);
          return created;
        } catch (error) {
          console.error('Failed to post DOCX comment', error);
          return null;
        }
      },
    },
  };

  const rootFor = (thread: LocatedThread): Root =>
    thread.root
      ? toRoot(thread.root, thread.markId)
      : draftRoot(thread.markId, userId() ?? '');

  return (
    <CommentsContext.Provider value={context}>
      <DocxMarginLayout
        comments={props.comments}
        editorRoot={props.editorRoot}
        margin={props.margin}
        revision={props.revision}
        canComment={props.canComment}
        renderCard={(thread, isActive) => (
          <ThreadCard comment={rootFor(thread)} isActive={isActive()} />
        )}
      />
    </CommentsContext.Provider>
  );
}

/** Threads whose text is gone, or that were left on an earlier rendering of the file. */
export function DocxDetachedComments(props: {
  documentId: string;
  threads: MessageListItem[];
  canComment: Accessor<boolean>;
  isOwner: Accessor<boolean>;
}) {
  const context: CommentsContextType = {
    setActiveThread: () => {},
    setThreadHeight: () => {},
    canComment: props.canComment,
    isDocumentOwner: props.isOwner,
    documentId: props.documentId,
    documentType: 'write',
    highlightedCommentId: () => null,
    messageOperations: { createComment: () => Promise.resolve(null) },
  };
  return (
    <Show when={props.threads.length}>
      <CommentsContext.Provider value={context}>
        <section
          class="flex flex-col gap-2"
          aria-label="Comments on changed text"
        >
          <h3 class="text-xs font-medium text-ink-muted">
            Comments on text that has changed
          </h3>
          <For each={props.threads}>
            {(thread) => (
              <div class="w-full">
                <ThreadCard
                  comment={toRoot(
                    thread,
                    thread.state.anchor && 'mark_id' in thread.state.anchor
                      ? thread.state.anchor.mark_id
                      : thread.id
                  )}
                  isActive
                />
              </div>
            )}
          </For>
        </section>
      </CommentsContext.Provider>
    </Show>
  );
}
