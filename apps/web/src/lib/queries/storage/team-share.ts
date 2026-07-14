import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { DocumentTeamShareResponse } from '@service-storage/generated/schemas/documentTeamShareResponse';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityKeys } from './keys';

const STALE_TIME = 60 * 1000;

/**
 * Team-share state of a document, resolved against the owner's team.
 * `teamId` is absent when the owner does not belong to a team — the
 * "Share with team" toggle should be hidden in that case.
 */
export function useDocumentTeamShareQuery(documentId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: entityKeys.documentTeamShare(documentId()).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.getDocumentTeamShare({
          documentId: documentId(),
        })
      ),
    staleTime: STALE_TIME,
    enabled: !!documentId(),
  }));
}

/** Share or unshare a document with the owner's team (grants the team Edit). */
export function useSetDocumentTeamShareMutation() {
  return useMutation(() => ({
    mutationFn: (params: { documentId: string; shareWithTeam: boolean }) =>
      throwOnErr(() => storageServiceClient.setDocumentTeamShare(params)),
    onSuccess(data: DocumentTeamShareResponse, { documentId }) {
      queryClient.setQueryData(
        entityKeys.documentTeamShare(documentId).queryKey,
        data
      );
    },
    onError(error: Error) {
      console.error('failed to set document team sharing', error);
    },
  }));
}
