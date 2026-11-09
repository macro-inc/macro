import type { ChannelEntity } from '@entity/types/entity';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import type { Accessor } from 'solid-js';
import {
  addChannels,
  changePreferences,
  channels,
  draft,
  favorites,
  labels,
  muted,
  preferences,
  saveDraft,
  setChannels,
  setDraft,
  setLabels,
  setMute,
  setSelected,
  updateSection,
} from './fixture-state';

export * from '../../../../../../components/app/GlobalAppState';
export * from '../../../../../../components/app/split-layout/layoutUtils';
export * from '../../../../../../features/next-soup/utils';
export * from '../../../../../../lib/core/context/channels';
export * from '../../../../../../lib/core/context/user';
export * from '../../../../../../lib/queries/channel/by-ids';
export * from '../../../../../../lib/queries/channel/join-links';
export * from '../../../../../../lib/queries/channel-labels/channel-labels';
export * from '../../../../../../lib/queries/favorites/favorites';
export * from '../../../../../../lib/queries/notification/unsubscribes';
export * from '../../../../../../lib/queries/team/teams';
export * from '../../../../channels-view-context';
export * from '../../../../queries/channel-list-search-pool';
export * from '../mobile/use-mobile-section-actions';

export const useUserId = () => () => 'viewer';
export const useIsAuthenticated = () => () => true;
export const useAuthor = () => () => 'Example User';
export const useUserInfo = () => () => undefined;
export const useUserTeamsQuery = () => ({
  isPending: false,
  isEnabled: true,
  data: [
    { id: 'team', name: 'Workspace' },
    { id: 'other-team', name: 'Other workspace' },
  ],
});
export const useCurrentTeamQuery = () => ({
  isPending: false,
  isEnabled: true,
  data: { team: { id: 'team', name: 'Workspace' } },
});
export function useChannelLabelsQuery(scope?: string) {
  return {
    isPending: false,
    isEnabled: true,
    isError: false,
    get data() {
      return {
        teamId: scope === 'personal' ? undefined : 'team',
        labels: labels.filter(
          (label) => Boolean(label.teamId) !== (scope === 'personal')
        ),
      };
    },
    refetch: async () => {},
  };
}
export const useAvailableSectionChannelsQuery = () => ({
  isPending: false,
  isEnabled: true,
  isError: false,
  isFetching: false,
  get data() {
    return channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      channel_type: channel.channelType,
      team_id: channel.teamId,
      is_participant: channel.isParticipant,
      owner_id: channel.ownerId,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      auto_join_team: false,
      participants: [],
    }));
  },
  refetch: async () => {},
});
export function useSmartTagPreviewQuery(
  pattern: Accessor<string>,
  scope?: string | Accessor<string>
) {
  return {
    isPending: false,
    isEnabled: true,
    isError: false,
    isLoading: false,
    isFetching: false,
    get data() {
      const shared = (typeof scope === 'function' ? scope() : scope) === 'team';
      const matches = channels.filter(
        (channel) =>
          channel.channelType !== 'direct_message' &&
          (shared ? channel.teamId === 'team' : channel.isParticipant) &&
          pattern().trim() &&
          channel.name.toLowerCase().includes(pattern().trim().toLowerCase())
      );
      return {
        channels: matches.map((channel) => ({
          id: channel.id,
          name: channel.name,
          isParticipant: channel.isParticipant,
        })),
        totalCount: matches.length,
      };
    },
  };
}
export const useChannelsContext = () => ({
  channels: () => useAvailableSectionChannelsQuery().data,
  channelsById: () =>
    Object.fromEntries(
      useAvailableSectionChannelsQuery().data.map((channel) => [
        channel.id,
        channel,
      ])
    ),
});
export const useCachedChannelsByIds = (ids: Accessor<readonly string[]>) => ({
  channels: () => channels.filter((channel) => ids().includes(channel.id)),
  isLoading: () => false,
  error: () => undefined,
  pendingIds: () => new Set<string>(),
  failedIds: () => new Set<string>(),
  retry: async () => {},
});
export const useChannelListSearchPool = () => () => channels;
export const useFavoritesData = () => () => ({ favorites: favorites() });
export const useMutedEntitiesQuery = () => ({
  isPending: false,
  isEnabled: true,
  get data() {
    return muted();
  },
});
export const useBulkNotificationPreferencesMutation = () => ({
  isPending: false,
  mutateAsync: async (args: {
    items: { item_id: string; item_type: 'channel' }[];
    muted: boolean;
    snoozedUntil?: string;
  }) => {
    await setMute(
      args.items.map((item) => item.item_id),
      args.muted,
      args.snoozedUntil ? new Date(args.snoozedUntil) : undefined
    );
    return { succeeded: args.items, failed: [] };
  },
});
export const useJoinChannelMutation = () => ({
  isPending: false,
  mutate: ({ channelId }: { channelId: string }) =>
    setChannels((channel) => channel.id === channelId, 'isParticipant', true),
});
export const useChannelsView = () => ({
  state: {
    sectionPreferences: preferences,
    sectionOrder: [],
    sortBy: {
      channels: 'updated_at',
      team_channels: 'updated_at',
      direct_messages: 'updated_at',
      threads: 'updated_at',
    },
  },
  sectionsEnabled: () => true,
  sectionsLoading: () => false,
  setSectionPreferences: changePreferences,
  setGroupOpen: () => {},
  setLabelOpen: () => {},
});
export const useMobileSectionActions = () => ({
  sectionDraft: draft,
  saveSectionDraft: saveDraft,
  cancelSectionDraft: () => setDraft(undefined),
  renameLabel: async (label: (typeof labels)[number]) => {
    setDraft({
      existing: label,
      initialChannelIds: [...label.channelIds],
      scope: label.teamId ? 'team' : 'personal',
    });
  },
  updateSection,
  addLabelChannels: addChannels,
  scopePending: () => false,
  changeScope: async (label: (typeof labels)[number], shared: boolean) =>
    updateSection(
      label,
      label.name,
      label.rule ?? undefined,
      shared ? 'team' : 'personal'
    ),
  deleteLabel: async (label: (typeof labels)[number]) => {
    setLabels(labels.filter((item) => item.id !== label.id));
  },
  muteSection: async (key: string, value: boolean) => {
    await setMute(
      labels.find((label) => `label:${label.id}` === key)?.channelIds ?? [],
      value
    );
  },
  snoozeSection: async (key: string, until?: Date) => {
    const ids =
      labels.find((label) => `label:${label.id}` === key)?.channelIds ?? [];
    if (until) await setMute(ids, true, until);
    else
      openSnoozeNotifications(
        ids.map((item_id) => ({ item_type: 'channel', item_id }))
      );
  },
});
export const useChannelCalls = () => ({
  callActivity: () => [],
  incomingCallIds: () => new Map<string, string>(),
  callStatuses: () => new Map<string, 'active' | 'incoming'>(),
});
export const useGlobalNotificationSource = () => ({
  notifications: () => [],
  withLocalState: (notification: { state: string }) => notification.state,
  incomingCalls: () => [],
  bulkMarkAsRead: async () => {},
  subscribe: () => () => {},
  mutedEntities: muted,
  loading: () => false,
  isEntityMuted: () => false,
});
export const useSplitPanelOrThrow = () => ({
  handle: {
    content: () => ({ type: 'component', id: 'channels' }),
    isActive: () => true,
    isPopover: () => false,
    setDisplayName: () => {},
  },
});
export const openEntityInSplitFromUnifiedList = async (
  channel: ChannelEntity
) => {
  setSelected(channel.id);
};
export const ChannelLabelMenuItems = () => null;
export const createSectionSearchSource = (options: {
  text: Accessor<string>;
  enabled: Accessor<boolean>;
  recent: Accessor<{ items: () => readonly ChannelEntity[] }>;
}) => ({
  items: () => {
    const text = options.text().toLowerCase();
    const matches = channels.filter(
      (channel) => !text || channel.name.includes(text)
    );
    return [
      ...matches.filter((channel) => channel.isParticipant === false),
      ...matches.filter((channel) => channel.isParticipant !== false),
    ];
  },
  isLoading: () => false,
  isFetching: () => false,
  isLoadingMore: () => false,
  error: () => undefined,
  hasMore: () => false,
  loadMore: async () => {},
  refresh: async () => {},
});
