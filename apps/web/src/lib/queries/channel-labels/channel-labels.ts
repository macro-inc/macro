import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableChannelTags,
  enableChatSidebarSections,
} from '@core/constant/featureFlags';
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
import type { QueryAccount } from '../auth/account-scope';
import { useQueryAccount } from '../auth/use-query-account';
import { listChannelsQueryOptions } from '../channel/channels';
import { queryClient } from '../client';
import { withCallbacks } from '../utils';
import { channelLabelKeys, channelSectionKeys } from './keys';

const keysForMode = (sectionMode = false) =>
  sectionMode ? channelSectionKeys : channelLabelKeys;
const clientForMode = (sectionMode = false) =>
  sectionMode
    ? storageServiceClient.channelSections
    : storageServiceClient.channelLabels;

export type { ChannelLabel, ChannelLabelScopeSelection };

function channelLabelsQueryOptions(
  enabled: boolean,
  scope: ChannelLabelScopeSelection | undefined,
  actorId: string | undefined,
  sectionMode = false
) {
  return queryOptions({
    queryKey: keysForMode(sectionMode).list(scope, actorId).queryKey,
    enabled: enabled && Boolean(actorId),
    queryFn: () => throwOnErr(() => clientForMode(sectionMode).list(scope)),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.labels.some((label) => label.rule) ? 30_000 : false,
    reconcile: 'id',
  });
}

/** Shared labels for team members; account-private labels otherwise. */
export function useChannelLabelsQuery(
  scope?: ChannelLabelScopeSelection,
  enabled: Accessor<boolean> = () => true
) {
  const channelTagsFlag = useFeatureFlag(enableChannelTags);
  const sectionsFlag = useFeatureFlag(enableChatSidebarSections);
  const userId = useUserId();
  return useQuery(() =>
    channelLabelsQueryOptions(
      channelTagsFlag().enabled && enabled(),
      scope,
      userId(),
      sectionsFlag().enabled
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
  return Promise.all(
    [channelLabelKeys, channelSectionKeys].map((keys) =>
      queryClient.invalidateQueries({
        queryKey: actorId ? keys.list(scope, actorId).queryKey : keys.list._def,
      })
    )
  );
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
  await Promise.all(
    [channelLabelKeys, channelSectionKeys].map((keys) =>
      queryClient.cancelQueries({
        queryKey: keys.list(scope, actorId).queryKey,
      })
    )
  );
}

function smartTagPreviewQueryOptions(
  contains: string,
  enabled: boolean,
  scope: ChannelLabelScopeSelection | undefined,
  actorId: string | undefined,
  sectionMode = false
) {
  return queryOptions({
    queryKey: keysForMode(sectionMode).preview(contains, scope, actorId)
      .queryKey,
    enabled: enabled && Boolean(actorId),
    queryFn: ({ signal }) =>
      throwOnErr(() =>
        clientForMode(sectionMode).preview(
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
  scope?: ChannelLabelScopeSelection | Accessor<ChannelLabelScopeSelection>
) {
  const channelTagsFlag = useFeatureFlag(enableChannelTags);
  const sectionsFlag = useFeatureFlag(enableChatSidebarSections);
  const userId = useUserId();
  const debouncedPattern = debouncedDependent(pattern, 150);
  return useQuery(() => {
    const contains = debouncedPattern().trim();
    const selectedScope = typeof scope === 'function' ? scope() : scope;
    return smartTagPreviewQueryOptions(
      contains,
      channelTagsFlag().enabled && contains.length > 0,
      selectedScope,
      userId(),
      sectionsFlag().enabled
    );
  });
}

function availableSectionChannelsQueryOptions(
  account: QueryAccount | undefined,
  enabled: boolean
) {
  return queryOptions({
    ...listChannelsQueryOptions(account, enabled),
    reconcile: 'id',
    staleTime: 0,
  });
}

/** Full authorized channel membership, scoped to the current account. */
export function useAvailableSectionChannelsQuery(
  enabled: Accessor<boolean> = () => true
) {
  const account = useQueryAccount();
  return useQuery(() =>
    availableSectionChannelsQueryOptions(account(), enabled())
  );
}

export type CreateChannelLabelArgs = {
  actorId: string | undefined;
  sectionMode?: boolean;
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
        clientForMode(args.sectionMode).create(
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
        if (args.sectionMode) return;
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
  sectionMode?: boolean;
  labelId: string;
  name: string;
  rule?: ChannelLabelRule;
  targetScope?: ChannelLabelScopeSelection;
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
        clientForMode(args.sectionMode).rename(
          args.labelId,
          {
            name: args.name,
            rule: args.rule,
            targetScope: args.targetScope,
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
        if (args.sectionMode) {
          if (args.targetScope && args.targetScope !== (scope ?? 'team')) {
            await cancelLabelFetch(
              args.targetScope === 'team' ? undefined : args.targetScope,
              args.actorId
            );
          }
          return;
        }
        const destinationScope =
          args.targetScope === 'team' ? undefined : args.targetScope;
        const changesScope =
          args.targetScope && args.targetScope !== (scope ?? 'team');
        if (!changesScope) {
          writeLabels(scope, args.actorId, (labels) =>
            labels.map((label) => (label.id === renamed.id ? renamed : label))
          );
          return;
        }

        await cancelLabelFetch(destinationScope, args.actorId);
        if (args.actorId !== userId()) return;

        writeLabels(scope, args.actorId, (labels) =>
          labels.filter((label) => label.id !== renamed.id)
        );
        writeLabels(destinationScope, args.actorId, (labels) =>
          labels
            .filter((label) => label.id !== renamed.id)
            .map((label) => {
              if (renamed.rule || label.rule) return label;
              const channelIds = label.channelIds.filter(
                (id) => !renamed.channelIds.includes(id)
              );
              return {
                ...label,
                channelIds,
                channelCount:
                  label.channelCount -
                  (label.channelIds.length - channelIds.length),
              };
            })
            .concat(renamed)
        );
      },
      onSettled: (_data, _error, args) => {
        if (args.actorId !== userId()) return;
        const refresh = [invalidateChannelLabels(scope, args.actorId)];
        if (args.targetScope && args.targetScope !== (scope ?? 'team')) {
          const destinationScope =
            args.targetScope === 'team' ? undefined : args.targetScope;
          refresh.push(invalidateChannelLabels(destinationScope, args.actorId));
        }
        return Promise.all(refresh);
      },
    }),
  }));
}

export type DeleteChannelLabelArgs = {
  labelId: string;
  actorId: string | undefined;
  sectionMode?: boolean;
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
        clientForMode(args.sectionMode).remove(args.labelId, scope)
      );
    },
    ...withCallbacks<void, Error, DeleteChannelLabelArgs>({
      onSuccess: async (_data, args) => {
        if (args.actorId !== userId()) return;
        await cancelLabelFetch(scope, args.actorId);
        if (args.actorId !== userId()) return;
        if (args.sectionMode) return;
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
  sectionMode?: boolean;
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
        clientForMode(args.sectionMode).setChannelLabel(
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
        if (args.sectionMode) return;
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
