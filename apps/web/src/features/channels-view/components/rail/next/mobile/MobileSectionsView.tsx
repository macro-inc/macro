import { SearchBar } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { beginInteraction, usePending } from '@app/observability/flow';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { enableChannelTags } from '@core/constant/featureFlags';
import { touchHandler } from '@core/directive/touchHandler';
import type { ChannelEntity } from '@entity';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { useCachedChannelsByIds } from '@queries/channel/by-ids';
import { useChannelLabelsQuery } from '@queries/channel-labels/channel-labels';
import { useFavoritesData } from '@queries/favorites/favorites';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button, Dialog, TabSelector, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import { useChannelsView } from '../../../../channels-view-context';
import type { ChannelsDataSource, ChannelsSources } from '../../../../queries';
import { deduplicateChannels } from '../../../../queries';
import { useChannelListSearchPool } from '../../../../queries/channel-list-search-pool';
import { ChannelsMobileView } from '../../../ChannelsMobileView';
import { createSectionSearchSource } from '../channel-discovery-source';
import { InlineSectionDraft } from '../InlineSectionDraft';
import { SectionChannelsPicker } from '../SectionChannelsDialog';
import { SectionRuleEditor } from '../SectionRuleEditor';
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
  const { state, sectionsEnabled, setSectionPreferences } = useChannelsView();
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
  const [query, setQuery] = createSignal('');
  const [searchOpen, setSearchOpen] = createSignal(false);
  let searchInput: HTMLInputElement | undefined;
  const keys = () => mobileSectionTabKeys(labels(), state.sectionOrder);
  const selected = () => resolveMobileSectionTab(selection(), keys());
  const selectedLabel = () =>
    labels().find((label) => `label:${label.id}` === selected());
  const preferences = () => {
    const label = selectedLabel();
    if (searchOpen() || !label) return;
    return {
      sort: 'name' as const,
      ...state.sectionPreferences[`label:${label.id}`],
    };
  };
  const tabElements = new Map<MobileSectionTab, HTMLElement>();
  createEffect(
    on(selected, (key) =>
      tabElements
        .get(key)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    )
  );
  const localChannels = useChannelListSearchPool();
  const members = useCachedChannelsByIds(
    () => selectedLabel()?.channelIds ?? [],
    sectionsEnabled
  );
  usePending('channels.section.members', members.isLoading);
  const search = createSectionSearchSource({
    enabled: searchOpen,
    text: query,
    recent: () => props.sources.recents,
    localChannels,
  });
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
      pinnedIds: props.pinned.map((channel) => channel.id),
      labels: labels(),
    });
  const base = () =>
    selected() === 'direct_messages'
      ? props.sources.direct_messages
      : props.sources.recents;
  const browsing: ChannelsDataSource = {
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
  const activeSource = () => (searchOpen() ? search : browsing);
  const source: ChannelsDataSource = {
    items: () => activeSource().items(),
    isLoading: () => activeSource().isLoading(),
    isFetching: () => activeSource().isFetching(),
    error: () => activeSource().error(),
    hasMore: () => activeSource().hasMore(),
    isLoadingMore: () => activeSource().isLoadingMore(),
    loadMore: async () => {
      await activeSource().loadMore();
    },
    refresh: async () => {
      await activeSource().refresh();
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
  const [sectionEditor, setSectionEditor] = createSignal<'add' | 'match'>();
  const optionsLabel = () =>
    labels().find((label) => label.id === optionsFor());
  const team = useCurrentTeamQuery();
  const favorites = useFavoritesData({ entityType: ['channel'] });
  const actions = useMobileSectionActions({
    enabled: () => sectionsEnabled() && channelTags().enabled,
    labels,
    labelsAvailable: () => queryReadyGate(shared) && queryReadyGate(personal),
    canShare: () => queryReadyGate(shared) && Boolean(shared.data?.teamId),
    channelsById: () =>
      new Map(
        deduplicateChannels([
          members.channels(),
          props.sources.recents.items(),
          localChannels(),
        ]).map((channel) => [channel.id, channel])
      ),
    favorites: () => favorites()?.favorites ?? [],
  });
  return (
    <TabSelector.Root
      value={selected()}
      onChange={choose}
      class="size-full min-h-0"
    >
      <ChannelsMobileView
        source={source}
        pinned={searchOpen() ? [] : props.pinned}
        searchQuery={query()}
        onClearSearch={() => setQuery('')}
        horizontalPins
        scrollKey={selected()}
        panelValue={selected()}
        preferences={preferences()}
        includePinnedInList={selected() !== 'all' || searchOpen()}
        headingForChannel={
          searchOpen()
            ? (channel, index) => {
                if (index !== 0 && channel.isParticipant === false) return;
                if (
                  index !== 0 &&
                  source.items()[index - 1]?.isParticipant !== false
                )
                  return;
                return channel.isParticipant === false
                  ? t('channelSections.notJoined')
                  : t(
                      query().trim()
                        ? 'channelSections.channels'
                        : 'channelSections.recent'
                    );
              }
            : undefined
        }
        header={
          <div class="flex flex-col gap-2 px-(--mobile-chrome-gutter) pb-2">
            <Show when={actions.sectionDraft()}>
              {(draft) => (
                <InlineSectionDraft
                  label={draft().existing}
                  scope={draft().scope}
                  canShare={
                    queryReadyGate(shared) && Boolean(shared.data?.teamId)
                  }
                  teamName={
                    queryReadyGate(team) ? team.data?.team.name : undefined
                  }
                  onSave={actions.saveSectionDraft}
                  onCancel={actions.cancelSectionDraft}
                />
              )}
            </Show>
            <Show
              when={searchOpen()}
              fallback={
                <div class="flex min-w-0 items-center gap-2">
                  <TabSelector>
                    <TabSelector.List
                      aria-label={t('channelSections.sections')}
                    >
                      <For each={keys()}>
                        {(key) => {
                          const label = () =>
                            labels().find(
                              (label) => `label:${label.id}` === key
                            );
                          return (
                            <Tooltip label={title(key)}>
                              <TabSelector.Tab
                                value={key}
                                ref={(element: HTMLButtonElement) => {
                                  tabElements.set(key, element);
                                  touchHandler(element, () => ({
                                    onLongPress: () => {
                                      const current = label();
                                      if (!current) return;
                                      setSelection(key);
                                      setOptionsFor(current.id);
                                    },
                                  }));
                                }}
                              >
                                <span class="truncate">{title(key)}</span>
                                <Show when={label()?.teamId}>
                                  <UsersIcon class="size-3.5 shrink-0" />
                                </Show>
                                <Show when={label()?.rule}>
                                  <FunnelIcon class="size-3.5 shrink-0" />
                                </Show>
                              </TabSelector.Tab>
                            </Tooltip>
                          );
                        }}
                      </For>
                    </TabSelector.List>
                  </TabSelector>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('channelSections.search')}
                    onClick={() => {
                      setSearchOpen(true);
                      searchInput?.focus();
                    }}
                  >
                    <SearchIcon class="size-4" />
                  </Button>
                </div>
              }
            >
              <SearchBar
                ref={(element) => {
                  searchInput = element;
                }}
                label={t('channelSections.search')}
                value={query()}
                onValueChange={setQuery}
                placeholder={t('channelSections.search')}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery('');
                  setSearchOpen(false);
                }}
              >
                {t('common.cancel')}
              </Button>
            </Show>
            <Show when={selectedLabel()}>
              {(label) => (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOptionsFor(label().id)}
                >
                  {t('channelSections.optionsFor', { name: label().name })}
                </Button>
              )}
            </Show>
          </div>
        }
      />
      <Show when={optionsLabel()}>
        {(label) => (
          <MobileSectionOptions
            label={label()}
            teamName={queryReadyGate(team) ? team.data?.team.name : undefined}
            canShare={queryReadyGate(shared) && Boolean(shared.data?.teamId)}
            preferences={
              state.sectionPreferences[`label:${label().id}`] ?? {
                sort: 'name',
              }
            }
            onPreferences={(preferences) =>
              setSectionPreferences(`label:${label().id}`, preferences)
            }
            onScope={(shared) => actions.changeScope(label(), shared)}
            onRename={async () => {
              const current = label();
              setOptionsFor(undefined);
              await actions.renameLabel(current);
            }}
            onAdd={async () => {
              setSectionEditor('add');
            }}
            onMatch={async () => {
              setSectionEditor('match');
            }}
            onDelete={() => actions.deleteLabel(label())}
            onMute={(muted) =>
              actions.muteSection(`label:${label().id}`, muted)
            }
            onSnooze={(until) =>
              actions.snoozeSection(`label:${label().id}`, until)
            }
            disabled={members.isLoading() || actions.scopePending()}
            onClose={() => {
              setSectionEditor(undefined);
              setOptionsFor(undefined);
            }}
            editors={
              <>
                <PickerSheet.Root
                  open={sectionEditor() === 'add'}
                  onCancel={() => setSectionEditor(undefined)}
                >
                  <Show when={sectionEditor() === 'add'}>
                    <SectionChannelsPicker
                      presentation="sheet"
                      label={label()}
                      onConfirm={(ids) =>
                        actions.addLabelChannels(label(), ids)
                      }
                      onClose={() => setSectionEditor(undefined)}
                    />
                  </Show>
                </PickerSheet.Root>
                <Show when={sectionEditor() === 'match'}>
                  <Dialog
                    open
                    onOpenChange={(open) => {
                      if (!open) setSectionEditor(undefined);
                    }}
                  >
                    <Dialog.Title class="sr-only">
                      {t('channelSections.matchByName')}
                    </Dialog.Title>
                    <SectionRuleEditor
                      label={label()}
                      onSave={(rule) =>
                        actions.updateSection(label(), label().name, rule)
                      }
                      onClose={() => setSectionEditor(undefined)}
                    />
                  </Dialog>
                </Show>
              </>
            }
          />
        )}
      </Show>
    </TabSelector.Root>
  );
}
