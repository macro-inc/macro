import type {
  DiscussionComment,
  DiscussionSource,
  DiscussionThread,
} from '@core/comments/discussion';
import { useUserId } from '@core/context/user';
import { createSignal } from 'solid-js';

// THROWAWAY (prototype): in-memory Macro discussion threads, lost on reload.
// The production implementation follows the CRM-comments pattern
// (rust/cloud-storage/crm/src/domain/comment.rs) with a `github_pr` entity
// type keyed by github_key; only this file changes when it lands.
export function createPrDiscussionSource(): DiscussionSource {
  const userId = useUserId();
  const [threads, setThreads] = createSignal<DiscussionThread[]>([]);

  const makeComment = (threadId: string, text: string): DiscussionComment => {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      threadId,
      authorId: userId() ?? '',
      text,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  };

  return {
    threads,
    canEdit: () => true,
    currentUserId: userId,
    targetCommentId: () => null,
    async createThread(text, _mentions) {
      const threadId = crypto.randomUUID();
      const thread: DiscussionThread = {
        id: threadId,
        resolved: false,
        comments: [makeComment(threadId, text)],
      };
      setThreads((prev) => [...prev, thread]);
    },
    async createReply(threadId, text, _mentions) {
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                comments: [...thread.comments, makeComment(threadId, text)],
              }
            : thread
        )
      );
    },
    async editComment(comment, text) {
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === comment.threadId
            ? {
                ...thread,
                comments: thread.comments.map((existing) =>
                  existing.id === comment.id
                    ? {
                        ...existing,
                        text,
                        updatedAt: new Date().toISOString(),
                      }
                    : existing
                ),
              }
            : thread
        )
      );
    },
    async deleteComment(comment) {
      setThreads((prev) =>
        prev
          .map((thread) =>
            thread.id === comment.threadId
              ? {
                  ...thread,
                  comments: thread.comments.filter(
                    (existing) => existing.id !== comment.id
                  ),
                }
              : thread
          )
          .filter((thread) => thread.comments.length > 0)
      );
    },
  };
}
