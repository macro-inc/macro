import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type {
  DocumentMetadata,
  EditDocumentServiceArgs,
} from '@service-storage/generated/schemas';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityKeys } from './keys';

const STALE_TIME = 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

async function fetchDocumentMetadata(
  documentId: string
): Promise<DocumentMetadata> {
  const result = await storageServiceClient.getDocumentMetadata({ documentId });
  if (result.isErr()) {
    throw new Error('Failed to fetch document metadata');
  }
  return result.value.documentMetadata;
}

export function useDocumentMetadataQuery(documentId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: entityKeys.documentMetadata(documentId()).queryKey,
    queryFn: () => fetchDocumentMetadata(documentId()),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!documentId(),
  }));
}

type EditDocumentMutationVariables = EditDocumentServiceArgs & {
  documentId: string;
};

export function useEditDocumentMutation() {
  return useMutation(() => ({
    mutationFn: async (params: EditDocumentMutationVariables) => {
      const result = await storageServiceClient.editDocument(params);
      if (result.isErr()) {
        throw new Error('Failed to edit document');
      }
      return result.value;
    },
    retry: 1,
    onError: (error) => {
      console.error('Failed to edit document', error);
    },
    onSuccess: (_data, variables) => {
      const queryKey = entityKeys.documentMetadata(
        variables.documentId
      ).queryKey;

      if (variables.documentName !== undefined) {
        queryClient.setQueryData<DocumentMetadata>(queryKey, (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            documentName: variables.documentName ?? '',
          };
        });
      }

      void queryClient.invalidateQueries({ queryKey });
    },
  }));
}
