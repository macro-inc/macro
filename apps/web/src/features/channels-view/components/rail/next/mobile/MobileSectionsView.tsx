import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { beginInteraction, usePending } from '@app/observability/flow';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { enableChannelTags } from '@core/constant/featureFlags';
import type { ChannelEntity } from '@entity';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { useCachedChannelsByIds } from '@queries/channel/by-ids';
import { useChannelLabelsQuery } from '@queries/channel-labels/channel-labels';
import { useFavoritesData } from '@queries/favorites/favorites';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { useChannelsView } from '../../../../channels-view-context';
import type { ChannelsDataSource, ChannelsSources } from '../../../../queries';
import { deduplicateChannels } from '../../../../queries';
import { useChannelListSearchPool } from '../../../../queries/channel-list-search-pool';
import { ChannelsMobileView } from '../../../ChannelsMobileView';
import { SectionChannelsPicker } from '../SectionChannelsDialog';
import { MobileSectionOptions } from './MobileSectionOptions';
import {
  channelsForMobileSection,
  type MobileSectionTab,
  mobileSectionTabKeys,
  resolveMobileSectionTab,
} from './mobile-section-tabs';
import { useMobileSectionActions } from './use-mobile-section-actions';

/** Flagged phone composition keeps Home rows, pin circles, and the existing navigation owner. */
export function MobileSectionsView(props: {
  sources: ChannelsSources;
  pinned: readonly ChannelEntity[];
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
  const localChannels = useChannelListSearchPool();
  const members = useCachedChannelsByIds(
    () => selectedLabel()?.channelIds ?? [],
    sectionsEnabled
  );
  usePending('channels.section.members', members.isLoading);
  const sectionChannels = () =>
    channelsForMobileSection({
      tab: selected(),
      channels: selectedLabel()
        ? deduplicateChannels([
            members.channels(),
            props.sources.recents.items(),
            localChannels(),
          ])
        : base().items(),
      labels: labels(),
    });
  const base = () =>
    selected() === 'direct_messages'
      ? props.sources.direct_messages
      : props.sources.recents;
  const source: ChannelsDataSource = {
    items: sectionChannels,
    isLoading: () =>
      selectedLabel() ? members.isLoading() : base().isLoading(),
    isFetching: () =>
      selectedLabel() ? members.isLoading() : base().isFetching(),
    error: () => (selectedLabel() ? members.error() : base().error()),
    hasMore: () => !selectedLabel() && base().hasMore(),
    isLoadingMore: () => !selectedLabel() && base().isLoadingMore(),
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
    if (key === 'direct_messages') return t('channelSections.direct_messages');
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
  const [sectionEditorOpen, setSectionEditorOpen] = createSignal(false);
  const optionsLabel = () =>
    labels().find((label) => label.id === optionsFor());
  const team = useCurrentTeamQuery();
  const favorites = useFavoritesData({ entityType: ['channel'] });
  const actions = useMobileSectionActions({
    enabled: () => sectionsEnabled() && channelTags().enabled,
    labels,
    labelsAvailable: () => queryReadyGate(shared) && queryReadyGate(personal),
    canShare: () => queryReadyGate(shared) && Boolean(shared.data?.teamId),
    teamId: () =>
      queryReadyGate(shared) ? (shared.data?.teamId ?? undefined) : undefined,
    channelsById: () =>
      new Map(
        deduplicateChannels([
          members.channels(),
          props.sources.recents.items(),
          localChannels(),
        ]).map((channel) => [channel.id, channel])
      ),
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
    <>
      <SplitHeaderLeft>
        <nav
          aria-label={t('channelSections.sections')}
          class="h-10 min-w-0 flex-1"
        >
          <PillTabs
            scrollable
            class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
            contentClass="px-(--mobile-chrome-gutter)"
            value={selected()}
            onChange={choose}
            items={keys().map((key) => ({
              value: key,
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
            leading={
              <Show when={selectedLabel()}>
                {(label) => (
                  <HeaderIsland>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('channelSections.optionsFor', {
                        name: label().name,
                      })}
                      onClick={() => setOptionsFor(label().id)}
                    >
                      <DotsThreeIcon class="size-5" />
                    </Button>
                  </HeaderIsland>
                )}
              </Show>
            }
          />
        </nav>
      </SplitHeaderLeft>
      <ChannelsMobileView
        source={source}
        pinned={props.pinned}
        searchQuery=""
        onClearSearch={() => {}}
        horizontalPins
        scrollKey={selected()}
        preferences={preferences()}
        includePinnedInList={selected() !== 'all'}
      />
      <Show when={optionsLabel()}>
        {(label) => (
          <MobileSectionOptions
            label={label()}
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
    </>
  );
}
