import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { beginInteraction, useFlow, usePending } from '@app/observability/flow';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { enableChannelTags } from '@core/constant/featureFlags';
import { useChannelDirectory } from '@core/context/channels';
import type { ChannelEntity } from '@entity';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { createChannelNotificationSettings } from '@notifications/primitives/create-channel-notification-settings';
import {
  type ChannelIdWindow,
  EMPTY_CHANNEL_WINDOW,
  useChannelWindow,
} from '@queries/channel/window';
import { useChannelLabelsQuery } from '@queries/channel-labels/channel-labels';
import { useFavoritesData } from '@queries/favorites/favorites';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  on,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { useChannelsView } from '../../../../channels-view-context';
import {
  advanceMemberDiscovery,
  keepDiscoveredRecords,
  type MemberDiscovery,
  type MemberDiscoverySources,
  memberDiscoveryBudget,
  memberDiscoveryStatus,
} from '../../../../core/member-discovery';
import type { ChannelsDataSource, ChannelsSources } from '../../../../queries';
import { deduplicateChannels } from '../../../../queries';
import {
  ChannelsMobileView,
  type MobileRowsOnScreen,
} from '../../../ChannelsMobileView';
import { sectionNotificationMenus } from '../../hooks/section-notification-menus';
import { useCollapsedUnreadChannels } from '../collapsed-unread-channels';
import { SectionChannelsPicker } from '../SectionChannelsDialog';
import { MobileSectionOptions } from './MobileSectionOptions';
import {
  channelsForMobileSection,
  type MobileSectionTab,
  mobileSectionMemberWindow,
  mobileSectionTabKeys,
  resolveMobileSectionTab,
} from './mobile-section-tabs';
import { useMobileSectionActions } from './use-mobile-section-actions';

/** Flagged phone composition keeps Home rows, pin circles, and the existing navigation owner. */
export function MobileSectionsView(props: {
  sources: ChannelsSources;
  pinned: readonly ChannelEntity[];
  localChannels: Accessor<ChannelEntity[]>;
  openPreview?: (channel: ChannelEntity) => boolean;
}) {
  const { state, sectionsEnabled, setSectionPreferences, setSectionOrder } =
    useChannelsView();
  const channelTags = useFeatureFlag(enableChannelTags);
  const shared = useChannelLabelsQuery(undefined, sectionsEnabled);
  const personal = useChannelLabelsQuery('personal', sectionsEnabled);
  const labels = createMemo(() => {
    if (!channelTags().enabled) return [];
    const teamLabels =
      queryReadyGate(shared) && shared.data?.teamId ? shared.data.labels : [];
    const personalLabels = queryReadyGate(personal)
      ? (personal.data?.labels ?? [])
      : [];
    return [...teamLabels, ...personalLabels];
  });
  const [selection, setSelection] = createSignal<MobileSectionTab>('all');
  const keys = () => mobileSectionTabKeys(labels(), state.sectionOrder);
  const selected = () => resolveMobileSectionTab(selection(), keys());
  const selectedLabel = () =>
    labels().find((label) => `label:${label.id}` === selected());
  const preferences = () => {
    const label = selectedLabel();
    if (!label) return;
    return {
      sort: 'name' as const,
      ...state.sectionPreferences[`label:${label.id}`],
    };
  };
  const localChannels = props.localChannels;
  const directory = useChannelDirectory();
  // Until the directory settles, its pool may still bring a section's members.
  const directorySettled = () => directory.complete() || directory.failed();
  // The pool carries no unread state, so a section's rows take it from here:
  // every unread channel under Unread only, otherwise the newest page.
  const unread = useCollapsedUnreadChannels(
    () => sectionsEnabled() && Boolean(selectedLabel()),
    () => preferences()?.unreadOnly === true
  );
  const liveIds = createMemo(
    () =>
      new Set(
        [...props.sources.recents.items(), ...unread()].map(
          (channel) => channel.id
        )
      )
  );
  const [rowsOnScreen, setRowsOnScreen] = createSignal<
    { tab: MobileSectionTab; rows: MobileRowsOnScreen } | undefined
  >(undefined, {
    equals: (previous, next) =>
      previous?.tab === next?.tab &&
      previous?.rows.ids === next?.rows.ids &&
      previous?.rows.start === next?.rows.start &&
      previous?.rows.end === next?.rows.end,
  });
  const memberIds = createMemo(sectionMemberWindow);
  const members = useChannelWindow(memberIds, sectionsEnabled);
  usePending('channels.section.members', members.isLoading);
  const flow = useFlow();
  createEffect(
    on(memberIds, (window) => {
      flow.span.setAttr('channels.section.members.ids', window.size);
      flow.span.setAttr('channels.section.members.dropped', window.dropped);
    })
  );
  const discoveringLabel = () => {
    const label = selectedLabel();
    if (!label || preferences()?.unreadOnly === true) return;
    return label;
  };
  const localIds = createMemo(
    () => new Set(localChannels().map((channel) => channel.id))
  );
  // What discovery found stays while its tab is chosen, past the window's
  // retention; the directory keeps joined channels itself.
  const discoveredChannels = createMemo<ReadonlyMap<string, ChannelEntity>>(
    (previous) => {
      const local = localIds();
      return keepDiscoveredRecords(
        previous,
        new Set(discoveringLabel()?.channelIds),
        members.channels().filter((channel) => !local.has(channel.id))
      );
    },
    new Map()
  );
  // Live records first, then the directory's and those that left the window.
  const sectionRecords = createMemo(() =>
    deduplicateChannels([
      members.channels(),
      unread(),
      props.sources.recents.items(),
      localChannels(),
      [...discoveredChannels().values()],
      members.retained(),
    ])
  );
  const channelsById = createMemo(
    () => new Map(sectionRecords().map((channel) => [channel.id, channel]))
  );
  // The selected section walks its unknown members once, from a cursor that
  // only moves forward, and waits for Load more after a run of misses; a tab
  // chosen again starts over. An Unread only tab lists what the unread
  // projection holds, so it discovers nothing.
  const [discoveryExtensions, setDiscoveryExtensions] = createStore<
    Record<string, number>
  >({});
  const discoveryBudget = (labelId: string) =>
    memberDiscoveryBudget(discoveryExtensions[labelId] ?? 0);
  const discoverySources: MemberDiscoverySources = {
    isKnown: (id) => channelsById().has(id),
    isUnavailable: (id) => members.unavailableIds().has(id),
  };
  const discovery = createMemo<MemberDiscovery | undefined>((previous) => {
    const label = discoveringLabel();
    if (!label) return;
    return advanceMemberDiscovery(
      previous,
      label.channelIds,
      discoverySources,
      discoveryBudget(label.id)
    );
  });
  const discoveryStatus = createMemo(() => {
    const label = discoveringLabel();
    const current = discovery();
    if (!label || !current) return;
    return memberDiscoveryStatus(
      current,
      discoverySources,
      discoveryBudget(label.id)
    );
  });
  const toDiscover = () => {
    const status = discoveryStatus();
    return status?.kind === 'next' ? status.ids : [];
  };
  const discovering = () =>
    discoveryStatus()?.kind === 'next' && !members.error();
  const loadMoreMembers = () => {
    const label = discoveringLabel();
    if (!label || discoveryStatus()?.kind !== 'paused') return;
    return () => {
      const interaction = beginInteraction('channels.section.load_more', {
        attributes: { 'channel.section.id': label.id },
      });
      try {
        setDiscoveryExtensions(label.id, (count) => (count ?? 0) + 1);
      } finally {
        interaction.end();
      }
    };
  };
  // The window reads records it resolved itself; it is built from this
  // declaration once the list has reported its rows, after the first layout.
  function sectionMemberWindow(): ChannelIdWindow {
    const label = selectedLabel();
    const report = rowsOnScreen();
    if (!label || report?.tab !== `label:${label.id}`) {
      return EMPTY_CHANNEL_WINDOW;
    }
    return mobileSectionMemberWindow({
      label,
      rows: report.rows,
      isLoaded: (id) => liveIds().has(id),
      discover: directorySettled() ? toDiscover() : [],
    });
  }
  const base = () =>
    selected() === 'direct_messages'
      ? props.sources.direct_messages
      : props.sources.recents;
  const sectionChannels = createMemo(() =>
    channelsForMobileSection({
      tab: selected(),
      channels: selectedLabel() ? sectionRecords() : base().items(),
      labels: labels(),
    })
  );
  const source: ChannelsDataSource = {
    items: sectionChannels,
    isLoading: () =>
      selectedLabel()
        ? members.isLoading() || discovering()
        : base().isLoading(),
    isFetching: () =>
      selectedLabel() ? members.isLoading() : base().isFetching(),
    error: () => (selectedLabel() ? members.error() : base().error()),
    // A section's members are looked up as its end comes on screen, so the
    // list asks for no pages; it shows more are coming until none are left,
    // or Load more after a run of misses.
    hasMore: () => !selectedLabel() && base().hasMore(),
    isLoadingMore: () =>
      selectedLabel() ? discovering() : base().isLoadingMore(),
    loadMore: async () => {
      if (!selectedLabel()) await base().loadMore();
    },
    refresh: async () => {
      await Promise.all([
        base().refresh(),
        members.retry(),
        shared.refetch(),
        personal.refetch(),
      ]);
    },
  };
  const title = (key: MobileSectionTab) => {
    if (key === 'all') return t('mobile.all');
    if (key === 'direct_messages')
      return t('channelSections.directMessagesPill');
    return labels().find((label) => `label:${label.id}` === key)?.name ?? '';
  };
  const choose = (value: string) => {
    const key = keys().find((key) => key === value);
    if (!key) return;
    const interaction = beginInteraction('channels.section.tab');
    try {
      setSelection(key);
    } finally {
      interaction.end();
    }
  };
  const [optionsFor, setOptionsFor] = createSignal<string>();
  const openSectionOptions = (id: string) => {
    const interaction = beginInteraction('channels.section.options', {
      attributes: { 'channel.section.id': id },
    });
    try {
      setOptionsFor(id);
    } finally {
      interaction.end();
    }
  };
  const [sectionEditorOpen, setSectionEditorOpen] = createSignal(false);
  const optionsLabel = () =>
    labels().find((label) => label.id === optionsFor());
  const team = useCurrentTeamQuery();
  const favorites = useFavoritesData({ entityType: ['channel'] });
  const channelNotifications = createChannelNotificationSettings({
    labels,
    resolveConflictChannels: true,
    channelById: (channelId) => channelsById().get(channelId),
    // A complete directory holds every joined channel; a filling one reads
    // them whole.
    readJoinedChannels: async (signal) =>
      directory.complete()
        ? directory.channels()
        : directory.readComplete(signal),
    favoriteChannelIds: () =>
      new Set(
        (favorites()?.favorites ?? [])
          .filter((favorite) => favorite.entityType === 'channel')
          .map((favorite) => favorite.entityId)
      ),
  });
  // Dialogs from the section's options sheet replace it, under this view.
  const sectionNotifications = sectionNotificationMenus(channelNotifications, {
    dialogOwner: getOwner(),
    closeSheet: () => setOptionsFor(undefined),
  });
  const actions = useMobileSectionActions({
    enabled: () => sectionsEnabled() && channelTags().enabled,
    labels,
    labelsAvailable: () => queryReadyGate(shared) && queryReadyGate(personal),
    canShare: () => queryReadyGate(shared) && Boolean(shared.data?.teamId),
    teamId: () =>
      queryReadyGate(shared) ? (shared.data?.teamId ?? undefined) : undefined,
    channelsById,
    favorites: () => favorites()?.favorites ?? [],
    onSectionCreated: (id) => {
      const key = `label:${id}` as const;
      const order = [
        ...new Set([
          ...state.sectionOrder,
          'favorites' as const,
          'direct_messages' as const,
          'team_channels' as const,
          ...keys().filter((key) => key !== 'all' && key !== 'direct_messages'),
        ]),
      ].filter((item) => item !== key);
      const insertion = order.indexOf('channels');
      order.splice(insertion < 0 ? order.length : insertion, 0, key);
      setSectionOrder(order);
      setSelection(key);
    },
  });
  return (
    <div class="flex size-full min-h-0 flex-col">
      <ChannelsMobileView
        source={source}
        pinned={props.pinned}
        openPreview={props.openPreview}
        searchQuery=""
        onClearSearch={() => {}}
        horizontalPins
        scrollKey={selected()}
        preferences={preferences()}
        includePinnedInList={selected() !== 'all'}
        onRowsOnScreen={(rows) => setRowsOnScreen({ tab: selected(), rows })}
        onLoadMore={loadMoreMembers()}
      >
        <nav
          aria-label={t('channelSections.sections')}
          class="min-w-0 px-(--mobile-chrome-gutter) pb-3"
        >
          <PillTabs
            scrollable
            class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
            contentClass="px-(--mobile-chrome-gutter)"
            value={selected()}
            onChange={choose}
            items={keys().map((key) => ({
              value: key,
              onContextMenu: key.startsWith('label:')
                ? () => openSectionOptions(key.slice('label:'.length))
                : undefined,
              label: (
                <span class="flex items-center gap-1.5">
                  {title(key)}
                  <Show
                    when={
                      labels().find((label) => `label:${label.id}` === key)
                        ?.teamId
                    }
                  >
                    <UsersIcon class="size-3.5 shrink-0" />
                  </Show>
                  <Show
                    when={
                      labels().find((label) => `label:${label.id}` === key)
                        ?.rule
                    }
                  >
                    <FunnelIcon class="size-3.5 shrink-0" />
                  </Show>
                </span>
              ),
            }))}
          />
        </nav>
      </ChannelsMobileView>
      <Show when={optionsLabel()}>
        {(label) => (
          <MobileSectionOptions
            label={label()}
            notifications={sectionNotifications(
              `label:${label().id}`,
              label().name
            )}
            teamName={queryReadyGate(team) ? team.data?.team.name : undefined}
            canShare={queryReadyGate(shared) && Boolean(shared.data?.teamId)}
            canEdit={actions.canEditSection(label())}
            canChangeScope={actions.canChangeSectionScope(label())}
            preferences={
              state.sectionPreferences[`label:${label().id}`] ?? {
                sort: 'name',
              }
            }
            onPreferences={(preferences) =>
              setSectionPreferences(`label:${label().id}`, preferences)
            }
            onScope={(shared) => actions.changeScope(label(), shared)}
            onEdit={async () => {
              const current = label();
              setOptionsFor(undefined);
              await actions.renameLabel(current);
            }}
            onAdd={async () => {
              setSectionEditorOpen(true);
            }}
            onMarkRead={() => actions.markSectionRead(`label:${label().id}`)}
            onDelete={() => actions.deleteLabel(label())}
            onMute={(muted) =>
              actions.muteSection(`label:${label().id}`, muted)
            }
            onSnooze={(until) =>
              actions.snoozeSection(`label:${label().id}`, until)
            }
            disabled={members.isLoading() || actions.scopePending()}
            onClose={() => {
              setSectionEditorOpen(false);
              setOptionsFor(undefined);
            }}
            editors={
              <PickerSheet.Root
                open={sectionEditorOpen()}
                onCancel={() => setSectionEditorOpen(false)}
              >
                <Show when={sectionEditorOpen()}>
                  <SectionChannelsPicker
                    presentation="sheet"
                    label={label()}
                    onConfirm={(ids) => actions.addLabelChannels(label(), ids)}
                    onClose={() => setSectionEditorOpen(false)}
                  />
                </Show>
              </PickerSheet.Root>
            }
          />
        )}
      </Show>
    </div>
  );
}
