import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { CrmCommentEntityType } from '@service-storage/generated/schemas/crmCommentEntityType';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { crmKeys } from './keys';

const CRM_COMMENTS_STALE_TIME = 60 * 1000;

/**
 * Comment threads for a CRM company or contact via
 * `GET /crm/comments/{entityType}/{entityId}`. Disabled until an entity
 * id is available.
 */
export function useCrmCommentsQuery(
  entityType: CrmCommentEntityType,
  entityId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = entityId();
    return {
      queryKey: crmKeys.comments(entityType, id ?? '').queryKey,
      queryFn: () => {
        if (!id) {
          throw new Error('entity id is required to fetch comments');
        }
        return throwOnErr(() =>
          storageServiceClient.crmComments.list({ entityType, entityId: id })
        );
      },
      enabled: !!id,
      staleTime: CRM_COMMENTS_STALE_TIME,
    };
  });
}

/**
 * Creates a CRM comment — a new thread when `threadId` is omitted, a reply
 * otherwise. Returns the updated thread; cache reconciliation is left to
 * the caller (the discussion source does point updates).
 */
export function useCreateCrmCommentMutation() {
  return useMutation(() => ({
    mutationFn: ({
      entityType,
      entityId,
      text,
      threadId,
    }: {
      entityType: CrmCommentEntityType;
      entityId: string;
      text: string;
      threadId?: string;
    }) =>
      throwOnErr(() =>
        storageServiceClient.crmComments.create({
          entityType,
          entityId,
          body: { text, threadId },
        })
      ),
  }));
}

/** Edits a CRM comment's text; returns the updated comment. */
export function useEditCrmCommentMutation() {
  return useMutation(() => ({
    mutationFn: ({ commentId, text }: { commentId: string; text: string }) =>
      throwOnErr(() =>
        storageServiceClient.crmComments.edit({ commentId, body: { text } })
      ),
  }));
}

/**
 * Deletes a CRM comment; the result reports whether the whole thread
 * went with it (last comment deleted).
 */
export function useDeleteCrmCommentMutation() {
  return useMutation(() => ({
    mutationFn: ({ commentId }: { commentId: string }) =>
      throwOnErr(() => storageServiceClient.crmComments.delete({ commentId })),
  }));
}
