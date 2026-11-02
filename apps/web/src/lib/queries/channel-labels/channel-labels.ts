import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableChannelTags } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { debouncedDependent } from '@core/util/debounce';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import type { ChannelLabelScopeSelection } from '@service-storage/generated/schemas/channelLabelScopeSelection';
import type { ChannelLabelsList } from '@service-storage/generated/schemas/channelLabelsList';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { withCallbacks } from '../utils';
import { channelLabelKeys } from './keys';

export type { ChannelLabel, ChannelLabelScopeSelection };

function channelLabelsQueryOptions(
  enabled: boolean,
  scope: ChannelLabelScopeSelection | undefined,
  actorId: string | undefined
) {
  return queryOptions({
    queryKey: channelLabelKeys.list(scope, actorId).queryKey,
    enabled: enabled && Boolean(actorId),
    queryFn: () =>
      throwOnErr(() => storageServiceClient.channelLabels.list(scope)),
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.labels.some((label) => label.rule) ? 30_000 : false,
    retry: false,
  });
}

/** Shared labels for team members; account-private labels otherwise. */
export function useChannelLabelsQuery(
  scope?: ChannelLabelScopeSelection,
  enabled: Accessor<boolean> = () => true
) {
  const channelTagsFlag = useFeatureFlag(enableChannelTags);
  const userId = useUserId();
  return useQuery(() =>
    channelLabelsQueryOptions(
      channelTagsFlag().enabled && enabled(),
      scope,
      userId()
    )
  );
}

/** Non-suspending view of labels, undefined until successfully loaded. */
export function useChannelLabelsData(
  scope?: ChannelLabelScopeSelection
): Accessor<ChannelLabel[] | undefined> {
  const query = useChannelLabelsQuery(scope);
  return () =>
    query.isEnabled && !query.isPending ? query.data?.labels : undefined;
}

export function invalidateChannelLabels(
  scope?: ChannelLabelScopeSelection,
  actorId?: string
) {
  return queryClient.invalidateQueries({
    queryKey: actorId
      ? channelLabelKeys.list(scope, actorId).queryKey
      : channelLabelKeys.list._def,
  });
}

function writeLabels(
  scope: ChannelLabelScopeSelection | undefined,
  actorId: string | undefined,
  update: (labels: ChannelLabel[]) => ChannelLabel[]
) {
  queryClient.setQueryData<ChannelLabelsList>(
    channelLabelKeys.list(scope, actorId).queryKey,
    (previous) =>
      previous ? { ...previous, labels: update(previous.labels) } : previous
  );
}

// Serialize writes, and publish only saved values. Temporary label IDs cannot
// be used as drop targets; snapshot rollback must not erase another saved edit.
const mutationScope = { id: 'channel-labels' };
async function cancelLabelFetch(
  scope: ChannelLabelScopeSelection | undefined,
  actorId: string | undefined
) {
  await queryClient.cancelQueries({
    queryKey: channelLabelKeys.list(scope, actorId).queryKey,
  });
}

function smartTagPreviewQueryOptions(
  contains: string,
  enabled: boolean,
  scope: ChannelLabelScopeSelection | undefined,
  actorId: string | undefined
) {
  return queryOptions({
    queryKey: channelLabelKeys.preview(contains, scope, actorId).queryKey,
    enabled: enabled && Boolean(actorId),
    queryFn: ({ signal }) =>
      throwOnErr(() =>
        storageServiceClient.channelLabels.preview(
          { attribute: 'name', contains },
          signal,
          scope
        )
      ),
    staleTime: 0,
    retry: false,
  });
}

export function useSmartTagPreviewQuery(
  pattern: Accessor<string>,
  scope?: ChannelLabelScopeSelection
) {
  const channelTagsFlag = useFeatureFlag(enableChannelTags);
  const userId = useUserId();
  const debouncedPattern = debouncedDependent(pattern, 150);
  return useQuery(() => {
    const contains = pattern();
    return smartTagPreviewQueryOptions(
      contains,
      channelTagsFlag().enabled &&
        contains.length > 0 &&
        contains === debouncedPattern(),
      scope,
      userId()
    );
  });
}

export type CreateChannelLabelArgs = {
  actorId: string | undefined;
  name: string;
  channelIds: string[];
  rule?: ChannelLabelRule;
};

export function useCreateChannelLabelMutation(
  scope?: ChannelLabelScopeSelection
) {
  const userId = useUserId();
  return useMutation(() => ({
    scope: mutationScope,
    mutationFn: async (args: CreateChannelLabelArgs) => {
      if (!args.actorId || args.actorId !== userId())
        throw new Error('The account has changed.');
      return await throwOnErr(() =>
        storageServiceClient.channelLabels.create(
          {
            name: args.name,
            channelIds: args.channelIds,
            rule: args.rule,
          },
          scope
        )
      );
    },
    ...withCallbacks<ChannelLabel, Error, CreateChannelLabelArgs>({
      onSuccess: async (created, args) => {
        if (args.actorId !== userId()) return;
        await cancelLabelFetch(scope, args.actorId);
        if (args.actorId !== userId()) return;
        writeLabels(scope, args.actorId, (labels) =>
          labels
            .map((label) => {
              if (created.rule || label.rule) return label;
              const channelIds = label.channelIds.filter(
                (id) => !created.channelIds.includes(id)
              );
              return {
                ...label,
                channelIds,
                channelCount:
                  label.channelCount -
                  (label.channelIds.length - channelIds.length),
              };
            })
            .concat(created)
        );
      },
      onSettled: (_data, _error, args) => {
        if (args.actorId === userId())
          return invalidateChannelLabels(scope, args.actorId);
      },
    }),
  }));
}

export type RenameChannelLabelArgs = {
  actorId: string | undefined;
  labelId: string;
  name: string;
  rule?: ChannelLabelRule;
};
export function useRenameChannelLabelMutation(
  scope?: ChannelLabelScopeSelection
) {
  const userId = useUserId();
  return useMutation(() => ({
    scope: mutationScope,
    mutationFn: async (args: RenameChannelLabelArgs) => {
      if (!args.actorId || args.actorId !== userId())
        throw new Error('The account has changed.');
      return await throwOnErr(() =>
        storageServiceClient.channelLabels.rename(
          args.labelId,
          {
            name: args.name,
            rule: args.rule,
          },
          scope
        )
      );
    },
    ...withCallbacks<ChannelLabel, Error, RenameChannelLabelArgs>({
      onSuccess: async (renamed, args) => {
        if (args.actorId !== userId()) return;
        await cancelLabelFetch(scope, args.actorId);
        if (args.actorId !== userId()) return;
        writeLabels(scope, args.actorId, (labels) =>
          labels.map((label) => (label.id === renamed.id ? renamed : label))
        );
      },
      onSettled: (_data, _error, args) => {
        if (args.actorId === userId())
          return invalidateChannelLabels(scope, args.actorId);
      },
    }),
  }));
}

export type DeleteChannelLabelArgs = {
  labelId: string;
  actorId: string | undefined;
};
export function useDeleteChannelLabelMutation(
  scope?: ChannelLabelScopeSelection
) {
  const userId = useUserId();
  return useMutation(() => ({
    scope: mutationScope,
    mutationFn: async (args: DeleteChannelLabelArgs) => {
      if (!args.actorId || args.actorId !== userId())
        throw new Error('The account has changed.');
      return await throwOnErr(() =>
        storageServiceClient.channelLabels.remove(args.labelId, scope)
      );
    },
    ...withCallbacks<void, Error, DeleteChannelLabelArgs>({
      onSuccess: async (_data, args) => {
        if (args.actorId !== userId()) return;
        await cancelLabelFetch(scope, args.actorId);
        if (args.actorId !== userId()) return;
        writeLabels(scope, args.actorId, (labels) =>
          labels.filter((label) => label.id !== args.labelId)
        );
      },
      onSettled: (_data, _error, args) => {
        if (args.actorId === userId())
          return invalidateChannelLabels(scope, args.actorId);
      },
    }),
  }));
}

export type SetChannelLabelArgs = {
  actorId: string | undefined;
  channelId: string;
  labelId: string | undefined;
};
export function useSetChannelLabelMutation(scope?: ChannelLabelScopeSelection) {
  const userId = useUserId();
  return useMutation(() => ({
    scope: mutationScope,
    mutationFn: async (args: SetChannelLabelArgs) => {
      if (!args.actorId || args.actorId !== userId())
        throw new Error('The account has changed.');
      return await throwOnErr(() =>
        storageServiceClient.channelLabels.setChannelLabel(
          args.channelId,
          {
            labelId: args.labelId ?? null,
          },
          scope
        )
      );
    },
    ...withCallbacks<void, Error, SetChannelLabelArgs>({
      onSuccess: async (_data, args) => {
        if (args.actorId !== userId()) return;
        await cancelLabelFetch(scope, args.actorId);
        if (args.actorId !== userId()) return;
        writeLabels(scope, args.actorId, (labels) =>
          labels.map((label) => {
            if (label.rule) return label;
            const channelIds = label.channelIds.filter(
              (id) => id !== args.channelId
            );
            const removed = label.channelIds.length - channelIds.length;
            if (label.id === args.labelId) channelIds.push(args.channelId);
            return {
              ...label,
              channelIds,
              channelCount:
                label.channelCount -
                removed +
                (label.id === args.labelId ? 1 : 0),
            };
          })
        );
      },
      onSettled: (_data, _error, args) => {
        if (args.actorId === userId())
          return invalidateChannelLabels(scope, args.actorId);
      },
    }),
  }));
}
