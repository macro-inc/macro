import type {
  DiscussionComment,
  DiscussionSource,
  DiscussionThread,
} from '@core/comments/discussion';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { compareDateAsc } from '@core/util/date';
import {
  useCreateCrmCommentMutation,
  useCrmCommentsQuery,
  useDeleteCrmCommentMutation,
  useEditCrmCommentMutation,
} from '@queries/crm/comments';
import { crmKeys } from '@queries/crm/keys';
import type { CrmComment } from '@service-storage/generated/schemas/crmComment';
import type { CrmCommentEntityType } from '@service-storage/generated/schemas/crmCommentEntityType';
import type { CrmCommentThread } from '@service-storage/generated/schemas/crmCommentThread';
import { useQueryClient } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';

/** Maps a server `CrmCommentThread` (uuid ids) to the normalized view model. */
function toViewThread(ct: CrmCommentThread): DiscussionThread {
  const comments: DiscussionComment[] = [...ct.comments]
    .sort((a, b) => compareDateAsc(a.createdAt, b.createdAt))
    .map((c) => ({
      id: c.commentId,
      threadId: c.threadId,
      authorId: c.sender ?? c.owner,
      text: c.text,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt ?? null,
    }));
  return {
    id: ct.thread.threadId,
    resolved: ct.thread.resolved,
    comments,
  };
}

/** Replaces the matching thread or appends it when new. */
function upsertThread(
  prev: CrmCommentThread[],
  next: CrmCommentThread
): CrmCommentThread[] {
  let replaced = false;
  const out = prev.map((t) => {
    if (t.thread.threadId === next.thread.threadId) {
      replaced = true;
      return next;
    }
    return t;
  });
  if (!replaced) out.push(next);
  return out;
}

/**
 * [`DiscussionSource`] backed by the CRM comments API for a company or
 * contact. Ids are already uuid strings, so no id adaptation is needed; the
 * `DISCUSSION:` mark filter doesn't apply either (every CRM thread is a
 * discussion). Backed by the `@queries/crm/comments` TanStack query with
 * point cache updates after each mutation. Must be called within a
 * component owner.
 */
export function useCrmDiscussionSource(
  entityType: CrmCommentEntityType,
  entityId: Accessor<string | undefined>
): DiscussionSource {
  const userId = useUserId();
  const queryClient = useQueryClient();

  const commentsQuery = useCrmCommentsQuery(entityType, entityId);
  const createMutation = useCreateCrmCommentMutation();
  const editMutation = useEditCrmCommentMutation();
  const deleteMutation = useDeleteCrmCommentMutation();

  const threads = createMemo<DiscussionThread[]>(() =>
    (commentsQuery.data ?? []).map(toViewThread)
  );

  const setThreads = (
    updater: (prev: CrmCommentThread[]) => CrmCommentThread[]
  ) => {
    const id = entityId();
    if (!id) return;
    queryClient.setQueryData<CrmCommentThread[]>(
      crmKeys.comments(entityType, id).queryKey,
      (prev) => updater(prev ?? [])
    );
  };

  const replaceComment = (updated: CrmComment) =>
    setThreads((prev) =>
      prev.map((ct) =>
        ct.thread.threadId === updated.threadId
          ? {
              ...ct,
              comments: ct.comments.map((c) =>
                c.commentId === updated.commentId ? updated : c
              ),
            }
          : ct
      )
    );

  return {
    threads,
    canEdit: () => !!userId(),
    currentUserId: userId,
    // CRM comments aren't deep-linked yet: no target to highlight, and
    // `buildCommentLink` is omitted so the copy-link affordance stays hidden.
    targetCommentId: () => null,
    async createThread(text) {
      const id = entityId();
      if (!id) return;
      try {
        const thread = await createMutation.mutateAsync({
          entityType,
          entityId: id,
          text,
        });
        setThreads((prev) => upsertThread(prev, thread));
      } catch (error) {
        console.error('Unable to create CRM comment', error);
        toast.failure('Could not post comment');
      }
    },
    async createReply(threadId, text) {
      const id = entityId();
      if (!id) return;
      try {
        const thread = await createMutation.mutateAsync({
          entityType,
          entityId: id,
          text,
          threadId,
        });
        setThreads((prev) => upsertThread(prev, thread));
      } catch (error) {
        console.error('Unable to reply to CRM comment', error);
        toast.failure('Could not post reply');
      }
    },
    async editComment(comment, text) {
      try {
        const updated = await editMutation.mutateAsync({
          commentId: comment.id,
          text,
        });
        replaceComment(updated);
      } catch (error) {
        console.error('Unable to edit CRM comment', error);
        toast.failure('Could not edit comment');
      }
    },
    async deleteComment(comment) {
      try {
        const { threadId, threadDeleted } = await deleteMutation.mutateAsync({
          commentId: comment.id,
        });
        setThreads((prev) =>
          threadDeleted
            ? prev.filter((ct) => ct.thread.threadId !== threadId)
            : prev.map((ct) =>
                ct.thread.threadId === threadId
                  ? {
                      ...ct,
                      comments: ct.comments.filter(
                        (c) => c.commentId !== comment.id
                      ),
                    }
                  : ct
              )
        );
      } catch (error) {
        console.error('Unable to delete CRM comment', error);
        toast.failure('Could not delete comment');
      }
    },
  };
}
