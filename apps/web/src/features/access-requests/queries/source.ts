import { throwOnErr } from '@core/util/result';
import { accessRequestKeys } from '@queries/access-requests/keys';
import {
  accessRequestsClient,
  invalidateAccessRequests,
  refreshSharedAccess,
  useAccessRequestState,
} from '@queries/access-requests/requests';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type { SharingSource } from '../context/contracts';
import type { AccessLevel, AccessRequest, ShareEntity } from '../core/types';

type Action =
  | { kind: 'submit'; level: AccessLevel; revision?: number }
  | { kind: 'cancel'; revision: number }
  | { kind: 'resolve'; request: AccessRequest; level: AccessLevel | null }
  | { kind: 'grant'; userId: string; level: AccessLevel | null };

type Change = Action & { target: ShareEntity };

function directAccessOptions(
  target: ShareEntity | undefined,
  enabled: boolean
) {
  return {
    queryKey: accessRequestKeys.entity(
      target?.entityType ?? '',
      target?.entityId ?? ''
    )._ctx.grants.queryKey,
    queryFn: () => {
      if (!target) throw new Error('No item selected');
      return throwOnErr(() => accessRequestsClient.grants(target));
    },
    enabled: !!target && enabled,
    throwOnError: false,
  };
}

export function createSharingSource(
  entity: Accessor<ShareEntity | undefined>,
  enabled: Accessor<boolean>
): SharingSource {
  const [offset, setOffset] = createSignal(0);
  const state = useAccessRequestState(entity, enabled, offset);
  const grants = useQuery(() => {
    const current = !state.isPending ? state.data : undefined;
    return directAccessOptions(
      entity(),
      enabled() &&
        !!current &&
        (current.accessLevel != null || current.canReview)
    );
  });
  const mutation = useMutation(() => ({
    mutationFn: async (change: Change) => {
      const target = change.target;
      return match(change)
        .with({ kind: 'submit' }, (change) =>
          throwOnErr(() =>
            accessRequestsClient.submit(target, change.level, change.revision)
          )
        )
        .with({ kind: 'cancel' }, (change) =>
          throwOnErr(() => accessRequestsClient.cancel(target, change.revision))
        )
        .with({ kind: 'resolve' }, (change) =>
          throwOnErr(() =>
            accessRequestsClient.resolve(
              target,
              change.request.id,
              change.request.revision,
              change.level
            )
          )
        )
        .with({ kind: 'grant' }, (change) =>
          throwOnErr(() =>
            accessRequestsClient.setGrant(target, change.userId, change.level)
          )
        )
        .exhaustive();
    },
    onSuccess: (_result, change) => {
      refreshSharedAccess(change.target);
      const current = entity();
      if (
        current?.entityType === change.target.entityType &&
        current.entityId === change.target.entityId
      )
        setOffset(0);
    },
    onError: (_error, change) => {
      void invalidateAccessRequests(change.target);
    },
  }));
  const mutate = (action: Action) => {
    const target = entity();
    if (!target) return Promise.reject(new Error('No item selected'));
    return mutation.mutateAsync({ ...action, target });
  };
  return {
    state: () => (state.isPending ? undefined : state.data),
    grants: () => (grants.isPending ? [] : (grants.data ?? [])),
    loading: () => state.isLoading,
    busy: () => mutation.isPending,
    error: () =>
      mutation.isError
        ? 'Could not update access. Refresh and try again.'
        : state.isError || grants.isError
          ? 'Could not load access requests.'
          : undefined,
    async refresh() {
      mutation.reset();
      await state.refetch();
      if (
        !state.isPending &&
        state.data &&
        (state.data.accessLevel != null || state.data.canReview)
      )
        await grants.refetch();
    },
    submit: (level, revision) => mutate({ kind: 'submit', level, revision }),
    cancel: (revision) => mutate({ kind: 'cancel', revision }),
    resolve: (request, level) => mutate({ kind: 'resolve', request, level }),
    setGrant: (userId, level) => mutate({ kind: 'grant', userId, level }),
    nextPage: () => {
      if (!state.isPending && state.data?.nextOffset != null)
        setOffset(state.data.nextOffset);
    },
    firstPage: () => setOffset(0),
  };
}
