import '@app/index.css';
import { createListController } from '@app/components/list';
import { SearchBar, ViewSidebar } from '@app/components/view-shell';
import { macroDarkTheme } from '@app/features/theme/themes/macro-dark';
import { macroLightTheme } from '@app/features/theme/themes/macro-light';
import { themeCssVars } from '@app/features/theme/utils/themeCssVars';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import type { ChannelEntity } from '@entity/types/entity';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Button, ImperativeDialogHost } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { ChannelsDataSource, ChannelsSources } from '../../../../queries';
import type { ChannelSectionKey } from '../../../../types';
import { ConversationsCreateMenu } from '../../../ConversationsCreateMenu';
import { ChannelOption } from '../../ChannelOption';
import {
  type ChannelRailActivationMetadata,
  type ChannelRailRow,
  type ChannelsRailContext,
  ChannelsRailProvider,
} from '../../ChannelsRailContext';
import { useChannelRailActivity } from '../../hooks/useChannelRailActivity';
import { ChannelLabelEmptyState, ChannelLabelRow } from '../ChannelLabelRows';
import { ChannelSectionHeading } from '../ChannelSectionHeading';
import { ChannelSectionDropdown } from '../ChannelSectionMenu';
import { InlineSectionDraft } from '../InlineSectionDraft';
import { MobileSectionsView } from '../mobile/MobileSectionsView';
import { ExpandedSearchResults } from '../SectionSearchResults';
import { useChannelCalls } from './fixture-adapters';
import {
  addChannels,
  changePreferences,
  channels,
  collapsed,
  draft,
  favorites,
  labels,
  preferences,
  saveDraft,
  selected,
  setDraft,
  setLabels,
  setMute,
  setSelected,
  toggleCollapsed,
  updateSection,
} from './fixture-state';

function source(items: () => readonly ChannelEntity[]): ChannelsDataSource {
  return {
    items,
    isLoading: () => false,
    isFetching: () => false,
    error: () => undefined,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    refresh: async () => {},
  };
}

function Fixture() {
  const phone = new URLSearchParams(location.search).has('phone');
  document.documentElement.dataset.themeLight = String(
    new URLSearchParams(location.search).has('light')
  );
  const light = new URLSearchParams(location.search).has('light');
  for (const [key, value] of Object.entries(
    themeCssVars(light ? macroLightTheme : macroDarkTheme)
  )) {
    document.documentElement.style.setProperty(key, value);
  }
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  const [query, setQuery] = createSignal('');
  const [searchOpen, setSearchOpen] = createSignal(false);
  const list = createListController<
    ChannelRailRow,
    ChannelRailActivationMetadata
  >({ items: () => [], getKey: (row) => row.id, isSelectable: () => false });
  const activity = useChannelRailActivity(() => channels, useChannelCalls());
  const matches = () =>
    channels.filter(
      (channel) =>
        !query() || channel.name.toLowerCase().includes(query().toLowerCase())
    );
  const searchResults = () => [
    ...matches().filter((channel) => channel.isParticipant === false),
    ...matches().filter((channel) => channel.isParticipant !== false),
  ];
  const sources: ChannelsSources = {
    team_channels: source(() =>
      channels.filter(
        (channel) => channel.channelType === 'team' && channel.isParticipant
      )
    ),
    channels: source(() =>
      channels.filter((channel) => channel.channelType === 'public')
    ),
    direct_messages: source(() =>
      channels.filter((channel) => channel.channelType === 'direct_message')
    ),
    recents: source(() => channels.filter((channel) => channel.isParticipant)),
    search: source(searchResults),
    threads: source(() => []),
  };
  const idsFor = (key: ChannelSectionKey) => {
    if (key === 'favorites')
      return favorites().map((favorite) => favorite.entityId);
    if (key.startsWith('label:'))
      return (
        labels.find((label) => `label:${label.id}` === key)?.channelIds ?? []
      );
    if (
      key === 'team_channels' ||
      key === 'channels' ||
      key === 'direct_messages'
    )
      return sources[key].items().map((channel) => channel.id);
    return [];
  };
  const rail: ChannelsRailContext = {
    railId: 'fixture',
    list,
    sectionsEnabled: () => true,
    tab: () => 'browse',
    selectTab: () => {},
    sources,
    favorites,
    channelById: (id) => channels.find((channel) => channel.id === id),
    selectedChannel: () => ({ type: 'channel', id: selected() }),
    threadsEnabled: () => false,
    threadsChannelId: () => undefined,
    isGroupOpen: (key) => !collapsed().includes(key),
    toggleGroup: toggleCollapsed,
    channelTagsEnabled: () => true,
    labels: () => labels,
    labelsAvailable: () => true,
    labelsUnavailableReason: () => '',
    labelsFailed: () => false,
    retryLabels: async () => {},
    retryReferencedChannels: async () => {},
    isLabelOpen: (id) => !collapsed().includes(id),
    toggleLabel: toggleCollapsed,
    channelSectionRows: () => [],
    labelUnreadCount: (label) =>
      label.channelIds.filter((id) => activity.unreadChannelIds().has(id))
        .length,
    createLabel: async (ids, scope = 'personal') => {
      setDraft({ initialChannelIds: ids, scope });
    },
    sectionDraft: draft,
    saveSectionDraft: saveDraft,
    cancelSectionDraft: () => setDraft(undefined),
    updateSection,
    createSmartTag: async () => {},
    editSmartTag: async () => {},
    canShareSections: () => true,
    addChannelsToLabel: async () => {},
    addLabelChannels: addChannels,
    renameLabel: async (label) => {
      setDraft({
        initialChannelIds: [...label.channelIds],
        scope: label.teamId ? 'team' : 'personal',
        existing: label,
      });
    },
    deleteLabel: async (label) => {
      setLabels(labels.filter((item) => item.id !== label.id));
    },
    setChannelLabel: (id, labelId, previous) => {
      if (labelId) {
        const label = labels.find((label) => label.id === labelId);
        if (label) {
          const channelIds = [...new Set([...label.channelIds, id])];
          setLabels((item) => item.id === labelId, {
            channelIds,
            channelCount: channelIds.length,
          });
        }
      } else {
        setLabels(
          (label) => label.id === previous,
          (label) => ({
            ...label,
            channelIds: label.channelIds.filter(
              (channelId) => channelId !== id
            ),
            channelCount: label.channelIds.filter(
              (channelId) => channelId !== id
            ).length,
          })
        );
      }
    },
    activeDropTarget: () => undefined,
    markLabelRead: () => {},
    muteSection: async (key, value) => {
      await setMute(idsFor(key), value);
    },
    snoozeSection: async (key, until) => {
      if (until) await setMute(idsFor(key), true, until);
      else
        openSnoozeNotifications(
          idsFor(key).map((item_id) => ({ item_type: 'channel', item_id }))
        );
    },
    sectionNotificationsDisabled: (key) => idsFor(key).length === 0,
    sortBy: () => 'updated_at',
    setSortBy: () => {},
    sectionPreferences: (key) => ({
      sort: key === 'favorites' ? 'manual' : 'name',
      ...preferences[key],
    }),
    setSectionPreferences: changePreferences,
    sectionOrder: () => [],
    setSectionOrder: () => {},
    registerRootRef: () => {},
    activateRow: (id) => {
      if (id.startsWith('label:')) toggleCollapsed(id.slice(6));
      else setSelected(id.slice(8).split(':')[0]);
    },
    prefetchRow: () => {},
    registerScrollRef: () => {},
    registerBrowseScrollHandle: () => () => {},
    registerVirtualizer: () => () => {},
    channelActivity: activity,
  };
  const visible = (key: ChannelSectionKey, ids = idsFor(key)) =>
    ids
      .flatMap((id) => channels.find((channel) => channel.id === id) ?? [])
      .filter((channel) => {
        if (
          preferences[key]?.unreadOnly &&
          !activity.unreadChannelIds().has(channel.id)
        )
          return false;
        const closed = key.startsWith('label:')
          ? collapsed().includes(key.slice(6))
          : collapsed().includes(key);
        return (
          !closed ||
          (preferences[key]?.unreadWhenCollapsed !== false &&
            activity.unreadChannelIds().has(channel.id))
        );
      });
  const builtin = (
    key: 'favorites' | 'direct_messages' | 'team_channels' | 'channels',
    name: string
  ) => (
    <section>
      <ChannelSectionHeading
        id={`section-${key}`}
        label={name}
        open={!collapsed().includes(key)}
        focused={false}
        unreadCount={0}
        onToggle={() => toggleCollapsed(key)}
      >
        <ChannelSectionDropdown section={key} label={name} />
      </ChannelSectionHeading>
      <div class="pl-2">
        <For each={visible(key)}>
          {(channel) => <ChannelOption channel={channel} />}
        </For>
      </div>
    </section>
  );
  return (
    <ChannelsRailProvider value={rail}>
      <Show
        when={phone}
        fallback={
          <main class="flex min-h-screen bg-page p-4 text-ink">
            <aside class="flex h-[calc(100dvh-2rem)] w-72 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel">
              <div class="flex h-12 shrink-0 items-center gap-2 px-(--sidebar-content-inset)">
                <ViewSidebar.Title>Chat</ViewSidebar.Title>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Search conversations"
                  onClick={() => setSearchOpen((open) => !open)}
                >
                  <SearchIcon class="size-4" />
                </Button>
              </div>
              <Show when={searchOpen()}>
                <div class="px-(--sidebar-gutter)">
                  <SearchBar
                    label="Search conversations"
                    value={query()}
                    onValueChange={setQuery}
                  />
                </div>
              </Show>
              <ViewSidebar.Primary>
                <ConversationsCreateMenu
                  presentation="sidebar"
                  onCreateSection={() => {
                    setDraft({ initialChannelIds: [], scope: 'personal' });
                  }}
                />
              </ViewSidebar.Primary>
              <Show
                when={searchOpen()}
                fallback={
                  <div class="scrollbar-hidden min-h-0 flex-1 space-y-2 overflow-y-auto px-(--sidebar-gutter) py-2">
                    <Show
                      when={draft() && !draft()?.existing ? draft() : undefined}
                    >
                      {(value) => (
                        <InlineSectionDraft
                          scope={value().scope}
                          canShare
                          teamName="Workspace"
                          onSave={saveDraft}
                          onCancel={() => setDraft(undefined)}
                        />
                      )}
                    </Show>
                    {builtin('favorites', 'Favorites')}
                    {builtin('direct_messages', 'Direct messages')}
                    {builtin('team_channels', 'Workspace channels')}
                    <For each={labels}>
                      {(label) => (
                        <section>
                          <ChannelLabelRow label={label} />
                          <div class="pl-2">
                            <For each={visible(`label:${label.id}`)}>
                              {(channel) => (
                                <ChannelOption
                                  channel={channel}
                                  labelId={label.id}
                                />
                              )}
                            </For>
                          </div>
                          <Show
                            when={
                              !label.channelIds.length &&
                              !collapsed().includes(label.id)
                            }
                          >
                            <ChannelLabelEmptyState label={label} />
                          </Show>
                        </section>
                      )}
                    </For>
                    {builtin('channels', 'All channels')}
                  </div>
                }
              >
                <ExpandedSearchResults
                  search={{
                    isOpen: searchOpen,
                    query,
                    results: searchResults,
                    isLoading: () => false,
                    error: () => undefined,
                    open: () => setSearchOpen(true),
                    close: () => setSearchOpen(false),
                    setQuery,
                    registerInput: () => {},
                    retry: async () => {},
                  }}
                />
              </Show>
              <div class="border-t border-edge-muted px-4 py-2 text-xs text-ink-extra-muted">
                Use [ ] to jump sections
              </div>
            </aside>
          </main>
        }
      >
        <div class="h-dvh bg-panel text-ink [--mobile-content-inset-top:3rem] [--mobile-content-inset-bottom:5rem]">
          <MobileSectionsView
            sources={sources}
            pinned={favorites().flatMap(
              (favorite) =>
                channels.find((channel) => channel.id === favorite.entityId) ??
                []
            )}
          />
        </div>
      </Show>
    </ChannelsRailProvider>
  );
}
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <Fixture />
          <ImperativeDialogHost />
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  document.getElementById('root')!
);
