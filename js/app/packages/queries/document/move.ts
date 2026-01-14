import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { storageServiceClient } from '@service-storage/client';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';

interface MoveDocumentParams {
  documentId: string;
  projectId: string;
}

interface MoveProjectParams {
  projectId: string;
  parentProjectId: string;
}

interface MoveChatParams {
  chatId: string;
  projectId: string;
}

interface CopyDocumentParams {
  documentId: string;
  documentName: string;
  projectId: string;
}

interface CopyChatParams {
  chatId: string;
  chatName: string;
  projectId: string;
}

export function useMoveDocumentMutation() {
  return useMutation(
    () => ({
      mutationFn: async ({ documentId, projectId }: MoveDocumentParams) => {
        return await throwOnErr(
          async () =>
            await storageServiceClient.editDocument({
              documentId,
              projectId,
            })
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['entity'] });
        queryClient.invalidateQueries({ queryKey: ['dss'] });
      },
      onError: () => {
        toast.failure('Failed to move document');
      },
    }),
    () => queryClient
  );
}

export function useMoveProjectMutation() {
  return useMutation(
    () => ({
      mutationFn: async ({ projectId, parentProjectId }: MoveProjectParams) => {
        return await throwOnErr(
          async () =>
            await storageServiceClient.projects.edit({
              id: projectId,
              projectParentId: parentProjectId,
            })
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['entity'] });
        queryClient.invalidateQueries({ queryKey: ['project'] });
      },
      onError: () => {
        toast.failure('Failed to move folder');
      },
    }),
    () => queryClient
  );
}

export function useMoveChatMutation() {
  return useMutation(
    () => ({
      mutationFn: async ({ chatId, projectId }: MoveChatParams) => {
        return await throwOnErr(
          async () =>
            await cognitionApiServiceClient.editChatProject({
              chat_id: chatId,
              project_id: projectId,
            })
        );
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['entity'] });
        queryClient.invalidateQueries({ queryKey: ['chat'] });
      },
      onError: () => {
        toast.failure('Failed to move chat');
      },
    }),
    () => queryClient
  );
}

export function useCopyDocumentMutation() {
  return useMutation(
    () => ({
      mutationFn: async ({
        documentId,
        documentName,
        projectId,
      }: CopyDocumentParams) => {
        // First copy the document
        const copyResult = await throwOnErr(
          async () =>
            await storageServiceClient.copyDocument({
              documentId,
              documentName,
            })
        );

        if (!copyResult?.documentId) {
          throw new Error('Failed to copy document');
        }

        // Then move the copy to the target project
        const newDocumentId = copyResult.documentId;
        await throwOnErr(
          async () =>
            await storageServiceClient.editDocument({
              documentId: newDocumentId,
              projectId,
            })
        );

        return copyResult;
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['entity'] });
        queryClient.invalidateQueries({ queryKey: ['dss'] });
      },
      onError: () => {
        toast.failure('Failed to copy document');
      },
    }),
    () => queryClient
  );
}

export function useCopyChatMutation() {
  return useMutation(
    () => ({
      mutationFn: async ({ chatId, chatName, projectId }: CopyChatParams) => {
        // First copy the chat
        const copyResult = await throwOnErr(
          async () =>
            await cognitionApiServiceClient.copyChat({
              chat_id: chatId,
              name: chatName,
            })
        );

        if (!copyResult?.id) {
          throw new Error('Failed to copy chat');
        }

        // Then move the copy to the target project
        const newChatId = copyResult.id;
        await throwOnErr(
          async () =>
            await cognitionApiServiceClient.editChatProject({
              chat_id: newChatId,
              project_id: projectId,
            })
        );

        return copyResult;
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['entity'] });
        queryClient.invalidateQueries({ queryKey: ['chat'] });
      },
      onError: () => {
        toast.failure('Failed to copy chat');
      },
    }),
    () => queryClient
  );
}
