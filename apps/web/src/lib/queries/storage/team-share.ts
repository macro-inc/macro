import { refetchSharePermissions } from '@core/component/TopBar/sharePermissionsRefetch';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentTeamShareResponse } from '@service-storage/generated/schemas/documentTeamShareResponse';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
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

/**
 * Share or unshare a document with the owner's team (grants the team Edit).
 * Writes the same column as `useSetTeamShareAccessLevelMutation`, so the
 * share dialog's permissions are refetched to keep the two surfaces agreeing.
 */
export function useSetDocumentTeamShareMutation() {
  return useMutation(() => ({
    mutationFn: (params: { documentId: string; shareWithTeam: boolean }) =>
      throwOnErr(() => storageServiceClient.setDocumentTeamShare(params)),
    onSuccess(data: DocumentTeamShareResponse, { documentId }) {
      queryClient.setQueryData(
        entityKeys.documentTeamShare(documentId).queryKey,
        data
      );
      refetchSharePermissions();
    },
    onError(error: Error) {
      console.error('failed to set document team sharing', error);
    },
  }));
}

/** Item types whose share permission carries an explicit team share. */
export type TeamShareItemType = Extract<
  ItemType,
  'document' | 'chat' | 'project'
>;

/** Levels an owner may grant the whole team — `owner` is never grantable. */
export type TeamShareAccessLevel = Exclude<AccessLevel, 'owner'>;

export type SetTeamShareAccessLevelArgs = {
  itemType: TeamShareItemType;
  id: string;
  /** A level shares with everyone on the owner's team; `null` stops sharing. */
  teamShareAccessLevel: TeamShareAccessLevel | null;
};

export function isTeamShareItemType(
  itemType: ItemType
): itemType is TeamShareItemType {
  return (
    itemType === 'document' || itemType === 'chat' || itemType === 'project'
  );
}

/**
 * Shares (or unshares) a document, chat, or folder with everyone on the
 * owner's team through the item's share-permission PATCH. Only
 * `teamShareAccessLevel` is sent, so link and channel shares are untouched.
 * The backend rejects non-owners (403) and a team-less owner (400); callers
 * surface those through the share dialog's toast.
 */
export function useSetTeamShareAccessLevelMutation() {
  return useMutation(() => ({
    mutationFn: async ({
      itemType,
      id,
      teamShareAccessLevel,
    }: SetTeamShareAccessLevelArgs): Promise<void> => {
      const sharePermission = { teamShareAccessLevel };
      await match(itemType)
        .with('chat', () =>
          throwOnErr(() =>
            cognitionApiServiceClient.updateChatPermissions({
              chat_id: id,
              sharePermission,
            })
          )
        )
        .with('document', () =>
          throwOnErr(() =>
            storageServiceClient.editDocument({
              documentId: id,
              sharePermission,
            })
          )
        )
        .with('project', () =>
          throwOnErr(() =>
            storageServiceClient.projects.edit({ id, sharePermission })
          )
        )
        .exhaustive();
    },
    onSuccess(_data, { itemType, id }) {
      if (itemType === 'document') {
        queryClient.invalidateQueries({
          queryKey: entityKeys.documentTeamShare(id).queryKey,
        });
      }
    },
    onError(error: Error) {
      console.error('failed to set team share access level', error);
    },
  }));
}
