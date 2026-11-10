import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { CreateSubteamRequest } from '@service-auth/generated/schemas/createSubteamRequest';
import type { Subteam } from '@service-auth/generated/schemas/subteam';
import type { SubteamRole } from '@service-auth/generated/schemas/subteamRole';
import type { UpdateSubteamRequest } from '@service-auth/generated/schemas/updateSubteamRequest';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { teamKeys } from './keys';

const subteamsKey = teamKeys.subteams.queryKey;

async function fetchSubteams(): Promise<Subteam[]> {
  const response = await throwOnErr(() => authServiceClient.listSubteams());
  return response.subteams;
}

export const subteamsQueryOptions = () =>
  queryOptions({
    queryKey: subteamsKey,
    queryFn: fetchSubteams,
    reconcile: 'id',
  });

/** The teams inside the viewer's workspace, with their members. */
export function useSubteamsQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({ ...subteamsQueryOptions(), enabled: enabled() }));
}

function writeSubteams(update: (subteams: Subteam[]) => Subteam[]) {
  queryClient.setQueryData<Subteam[]>(subteamsKey, (old) =>
    old ? update(old) : old
  );
}

/**
 * Every write to the list shares this key. Writes can overlap (Add people
 * sends one per person), and each response or rollback carries only its own
 * view of the list, so they're applied only while nothing else is in flight;
 * otherwise the list is read again once the last write settles.
 */
const SUBTEAM_WRITES = { mutationKey: subteamsKey };

/** Whether no other write is in flight. A write counts itself until it settles. */
const writingAlone = () => queryClient.isMutating(SUBTEAM_WRITES) <= 1;

/** Whether writes overlapped since the list last matched the server. */
let overlapped = false;

/** Puts the server's copy of a team into the list. */
function storeSubteam(subteam: Subteam) {
  if (!writingAlone()) return;

  writeSubteams((subteams) =>
    subteams.some((existing) => existing.id === subteam.id)
      ? subteams.map((existing) =>
          existing.id === subteam.id ? subteam : existing
        )
      : [...subteams, subteam]
  );
}

/** Adds a new team; no other write's response can know it yet. */
function addSubteam(subteam: Subteam) {
  writeSubteams((subteams) =>
    subteams.some((existing) => existing.id === subteam.id)
      ? subteams
      : [...subteams, subteam]
  );
}

type Snapshot = { previous: Subteam[] | undefined };

/** Applies an optimistic change, returning what to roll back to. */
async function optimistic(
  update: (subteams: Subteam[]) => Subteam[]
): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: subteamsKey });
  if (!writingAlone()) overlapped = true;
  const previous = queryClient.getQueryData<Subteam[]>(subteamsKey);
  writeSubteams(update);
  return { previous };
}

function rollback(context: Snapshot | undefined) {
  if (!writingAlone()) return;
  if (context?.previous) {
    queryClient.setQueryData(subteamsKey, context.previous);
  }
}

/** After the last of overlapping writes, reads the list the server ended with. */
function reconcile() {
  if (!overlapped || !writingAlone()) return;
  overlapped = false;
  queryClient.invalidateQueries({ queryKey: subteamsKey });
}

function reportFailure(message: string, error: Error) {
  console.error(message, error);
  toast.failure(message);
}

export function useCreateSubteamMutation(
  callbacks?: MutationCallbacks<Subteam, Error, CreateSubteamRequest>
) {
  return useMutation(() => ({
    ...SUBTEAM_WRITES,
    mutationFn: (request: CreateSubteamRequest) =>
      throwOnErr(() => authServiceClient.createSubteam(request)),
    ...withCallbacks<Subteam, Error, CreateSubteamRequest>(
      {
        onMutate: () => {
          if (!writingAlone()) overlapped = true;
        },
        onSuccess: addSubteam,
        onError: (error) =>
          reportFailure(t('settingsTeams.createFailed'), error),
        onSettled: reconcile,
      },
      callbacks
    ),
  }));
}

type UpdateSubteamArgs = { subteamId: string; request: UpdateSubteamRequest };

export function useUpdateSubteamMutation() {
  return useMutation(() => ({
    ...SUBTEAM_WRITES,
    mutationFn: ({ subteamId, request }: UpdateSubteamArgs) =>
      throwOnErr(() => authServiceClient.updateSubteam(subteamId, request)),
    ...withCallbacks<Subteam, Error, UpdateSubteamArgs, Snapshot>({
      onMutate: ({ subteamId, request }) =>
        optimistic((subteams) =>
          subteams.map((subteam) =>
            subteam.id === subteamId
              ? {
                  ...subteam,
                  name: request.name ?? subteam.name,
                  description: request.description ?? subteam.description,
                  color: request.color ?? subteam.color,
                  joinPolicy: request.joinPolicy ?? subteam.joinPolicy,
                }
              : subteam
          )
        ),
      onSuccess: storeSubteam,
      onError: (error, _args, context) => {
        rollback(context);
        reportFailure(t('settingsTeams.updateFailed'), error);
      },
      onSettled: reconcile,
    }),
  }));
}

type NestSubteamArgs = { subteamId: string; parentId: string | null };

export function useNestSubteamMutation() {
  return useMutation(() => ({
    ...SUBTEAM_WRITES,
    mutationFn: ({ subteamId, parentId }: NestSubteamArgs) =>
      throwOnErr(() => authServiceClient.nestSubteam(subteamId, parentId)),
    ...withCallbacks<Subteam, Error, NestSubteamArgs, Snapshot>({
      onMutate: ({ subteamId, parentId }) =>
        optimistic((subteams) =>
          subteams.map((subteam) =>
            subteam.id === subteamId ? { ...subteam, parentId } : subteam
          )
        ),
      onSuccess: storeSubteam,
      onError: (error, _args, context) => {
        rollback(context);
        reportFailure(t('settingsTeams.moveFailed'), error);
      },
      onSettled: reconcile,
    }),
  }));
}

export function useDeleteSubteamMutation(
  callbacks?: MutationCallbacks<void, Error, string, Snapshot>
) {
  return useMutation(() => ({
    ...SUBTEAM_WRITES,
    mutationFn: (subteamId: string) =>
      throwOnErr(() => authServiceClient.deleteSubteam(subteamId)),
    ...withCallbacks<void, Error, string, Snapshot>(
      {
        // The server moves a deleted team's teams to the top level.
        onMutate: (subteamId) =>
          optimistic((subteams) =>
            subteams
              .filter((subteam) => subteam.id !== subteamId)
              .map((subteam) =>
                subteam.parentId === subteamId
                  ? { ...subteam, parentId: null }
                  : subteam
              )
          ),
        onError: (error, _subteamId, context) => {
          rollback(context);
          reportFailure(t('settingsTeams.deleteFailed'), error);
        },
        onSettled: reconcile,
      },
      callbacks
    ),
  }));
}

type SaveSubteamMemberArgs = {
  subteamId: string;
  userId: string;
  role: SubteamRole;
};

export function useSaveSubteamMemberMutation() {
  return useMutation(() => ({
    ...SUBTEAM_WRITES,
    mutationFn: ({ subteamId, userId, role }: SaveSubteamMemberArgs) =>
      throwOnErr(() =>
        authServiceClient.saveSubteamMember(subteamId, userId, role)
      ),
    ...withCallbacks<Subteam, Error, SaveSubteamMemberArgs, Snapshot>({
      onMutate: ({ subteamId, userId, role }) =>
        optimistic((subteams) =>
          subteams.map((subteam) =>
            subteam.id === subteamId
              ? {
                  ...subteam,
                  members: subteam.members.some(
                    (member) => member.userId === userId
                  )
                    ? subteam.members.map((member) =>
                        member.userId === userId ? { userId, role } : member
                      )
                    : [...subteam.members, { userId, role }],
                }
              : subteam
          )
        ),
      onSuccess: storeSubteam,
      onError: (error, _args, context) => {
        rollback(context);
        reportFailure(t('settingsTeams.saveMemberFailed'), error);
      },
      onSettled: reconcile,
    }),
  }));
}

type RemoveSubteamMemberArgs = { subteamId: string; userId: string };

export function useRemoveSubteamMemberMutation() {
  return useMutation(() => ({
    ...SUBTEAM_WRITES,
    mutationFn: ({ subteamId, userId }: RemoveSubteamMemberArgs) =>
      throwOnErr(() =>
        authServiceClient.removeSubteamMember(subteamId, userId)
      ),
    ...withCallbacks<Subteam, Error, RemoveSubteamMemberArgs, Snapshot>({
      onMutate: ({ subteamId, userId }) =>
        optimistic((subteams) =>
          subteams.map((subteam) =>
            subteam.id === subteamId
              ? {
                  ...subteam,
                  members: subteam.members.filter(
                    (member) => member.userId !== userId
                  ),
                }
              : subteam
          )
        ),
      onSuccess: storeSubteam,
      onError: (error, _args, context) => {
        rollback(context);
        reportFailure(t('settingsTeams.removeMemberFailed'), error);
      },
      onSettled: reconcile,
    }),
  }));
}
