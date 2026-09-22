import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableChannelTags } from '@core/constant/featureFlags';
import { debouncedDependent } from '@core/util/debounce';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelRule } from '@service-storage/generated/schemas/channelLabelRule';
import type { ChannelLabelsList } from '@service-storage/generated/schemas/channelLabelsList';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { withCallbacks } from '../utils';
import { channelLabelKeys } from './keys';

export type { ChannelLabel };

/** Shared labels for team members; account-private labels otherwise. */
export function useChannelLabelsQuery() {
  const channelTagsFlag = useFeatureFlag(enableChannelTags);
  return useQuery(() => ({
    queryKey: channelLabelKeys.list.queryKey,
    enabled: channelTagsFlag().enabled,
    queryFn: async () =>
      await throwOnErr(() => storageServiceClient.channelLabels.list()),
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.labels.some((label) => label.rule) ? 30_000 : false,
    retry: false,
  }));
}

/** Non-suspending view of labels, undefined until successfully loaded. */
export function useChannelLabelsData(): Accessor<ChannelLabel[] | undefined> {
  const query = useChannelLabelsQuery();
  return () =>
    query.isEnabled && query.isSuccess ? query.data.labels : undefined;
}

export function invalidateChannelLabels() {
  return queryClient.invalidateQueries({
    queryKey: channelLabelKeys.list.queryKey,
  });
}

function writeLabels(update: (labels: ChannelLabel[]) => ChannelLabel[]) {
  queryClient.setQueryData<ChannelLabelsList>(
    channelLabelKeys.list.queryKey,
    (previous) =>
      previous ? { ...previous, labels: update(previous.labels) } : previous
  );
}

// Serialize writes, and publish only saved values. Temporary label IDs cannot
// be used as drop targets; snapshot rollback must not erase another saved edit.
const mutationScope = { id: 'channel-labels' };
async function cancelLabelFetch() {
  await queryClient.cancelQueries({ queryKey: channelLabelKeys.list.queryKey });
}

export function useSmartTagPreviewQuery(pattern: Accessor<string>) {
  const channelTagsFlag = useFeatureFlag(enableChannelTags);
  const debouncedPattern = debouncedDependent(pattern, 150);
  return useQuery(() => {
    const contains = pattern();
    return {
      queryKey: channelLabelKeys.preview(contains).queryKey,
      enabled:
        channelTagsFlag().enabled &&
        contains.length > 0 &&
        contains === debouncedPattern(),
      queryFn: async ({ signal }) =>
        await throwOnErr(() =>
          storageServiceClient.channelLabels.preview(
            { attribute: 'name', contains },
            signal
          )
        ),
      staleTime: 0,
      retry: false,
    };
  });
}

export type CreateChannelLabelArgs = {
  name: string;
  channelIds: string[];
  rule?: ChannelLabelRule;
};

export function useCreateChannelLabelMutation() {
  return useMutation(() => ({
    scope: mutationScope,
    mutationFn: async (args: CreateChannelLabelArgs) =>
      await throwOnErr(() => storageServiceClient.channelLabels.create(args)),
    ...withCallbacks<ChannelLabel, Error, CreateChannelLabelArgs>({
      onSuccess: async (created) => {
        await cancelLabelFetch();
        writeLabels((labels) =>
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
      onSettled: () => invalidateChannelLabels(),
    }),
  }));
}

export type RenameChannelLabelArgs = {
  labelId: string;
  name: string;
  rule?: ChannelLabelRule;
};
export function useRenameChannelLabelMutation() {
  return useMutation(() => ({
    scope: mutationScope,
    mutationFn: async (args: RenameChannelLabelArgs) =>
      await throwOnErr(() =>
        storageServiceClient.channelLabels.rename(args.labelId, {
          name: args.name,
          rule: args.rule,
        })
      ),
    ...withCallbacks<ChannelLabel, Error, RenameChannelLabelArgs>({
      onSuccess: async (renamed) => {
        await cancelLabelFetch();
        writeLabels((labels) =>
          labels.map((label) => (label.id === renamed.id ? renamed : label))
        );
      },
      onSettled: () => invalidateChannelLabels(),
    }),
  }));
}

export type DeleteChannelLabelArgs = { labelId: string };
export function useDeleteChannelLabelMutation() {
  return useMutation(() => ({
    scope: mutationScope,
    mutationFn: async (args: DeleteChannelLabelArgs) =>
      await throwOnErr(() =>
        storageServiceClient.channelLabels.remove(args.labelId)
      ),
    ...withCallbacks<void, Error, DeleteChannelLabelArgs>({
      onSuccess: async (_data, args) => {
        await cancelLabelFetch();
        writeLabels((labels) =>
          labels.filter((label) => label.id !== args.labelId)
        );
      },
      onSettled: () => invalidateChannelLabels(),
    }),
  }));
}

export type SetChannelLabelArgs = {
  channelId: string;
  labelId: string | undefined;
};
export function useSetChannelLabelMutation() {
  return useMutation(() => ({
    scope: mutationScope,
    mutationFn: async (args: SetChannelLabelArgs) =>
      await throwOnErr(() =>
        storageServiceClient.channelLabels.setChannelLabel(args.channelId, {
          labelId: args.labelId ?? null,
        })
      ),
    ...withCallbacks<void, Error, SetChannelLabelArgs>({
      onSuccess: async (_data, args) => {
        await cancelLabelFetch();
        writeLabels((labels) =>
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
      onSettled: () => invalidateChannelLabels(),
    }),
  }));
}
