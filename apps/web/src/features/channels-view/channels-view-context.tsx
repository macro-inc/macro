import {
  type ChannelPreviewSelection,
  channelIdForPreviewNavigation,
  getChannelEntityTarget,
} from '@app/features/next-soup/utils';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { channelDetailRoute, channelsSplitRoute } from '@app/routes/routes';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  enableChannelThreadsPreview,
  enableChatSidebarSections,
} from '@core/constant/featureFlags';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ContextProviderProps } from '@solid-primitives/context';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { createStore, type Store } from 'solid-js/store';
import { channelsSearch, channelsSearchCodec } from './channels-route';
import { CHANNELS_DEFAULT_SORT_BY } from './constants';
import { createChannelsViewPersistence } from './persistence';
import type {
  ChannelListSort,
  ChannelSectionKey,
  ChannelSectionPreferences,
  ChannelsRailSection,
  ChannelsSortGroup,
  ChannelsTab,
  ChannelsViewState,
  ChannelsViewStateOptions,
} from './types';

type ChannelsViewProviderProps = ContextProviderProps & {
  initialState?: ChannelsViewStateOptions;
};

/** A selection that asked for its conversation's composer to take focus. */
export type ComposerFocusRequest = { channelId: string; id: number };

export type SelectChannelOptions = {
  /**
   * A click or Enter on a row: an already open conversation focuses its
   * composer again. A newly shown one decides from how it arrived.
   */
  focusComposer?: boolean;
};

export type ChannelsViewContext = {
  state: Store<ChannelsViewState>;
  /** The mobile list opens channels in the split; only desktop renders detail. */
  mobileLayout: () => boolean;
  /** Whether the redesigned desktop sections are enabled. */
  sectionsEnabled: Accessor<boolean>;
  sectionsLoading: Accessor<boolean>;
  selectedChannel: Accessor<ChannelPreviewSelection | undefined>;
  /** Set by a selection with `focusComposer`; any other selection clears it. */
  composerFocusRequest: Accessor<ComposerFocusRequest | undefined>;
  /** Whether the Threads tab is available to this user. */
  threadsEnabled: Accessor<boolean>;
  /**
   * The tab to render. A stored or linked Threads tab shows All while the flag
   * is off or still loading, and returns once it resolves on; `state.tab`
   * keeps the choice so persistence and URLs are not rewritten.
   */
  tab: Accessor<ChannelsTab>;
  /** Threads tab filter: the conversation whose threads are shown, or all. */
  threadsChannelId: Accessor<string | undefined>;
  setThreadsChannelId: (channelId: string | undefined) => void;
  setTab: (tab: ChannelsTab) => void;
  setSelectedChannel: (
    channel: ChannelPreviewSelection | undefined,
    options?: SelectChannelOptions
  ) => boolean;
  /** Keyboard focus to a conversation's sidebar row; false without a rail. */
  focusRailRow: (channelId: string) => boolean;
  /** The rail supplies `focusRailRow` for as long as it is mounted. */
  registerRailRowFocus: (focus: (channelId: string) => boolean) => void;
  setGroupOpen: (group: ChannelsRailSection, open: boolean) => void;
  /** Per-user collapse state of a team channel label. */
  setLabelOpen: (labelId: string, open: boolean) => void;
  setSortBy: (group: ChannelsSortGroup, sort: ChannelListSort) => void;
  setSectionPreferences: (
    section: ChannelSectionKey,
    preferences: ChannelSectionPreferences
  ) => void;
  setSectionOrder: (sections: ChannelSectionKey[]) => void;
};

function createInitialState(
  initial: ChannelsViewStateOptions
): ChannelsViewState {
  return {
    tab: initial.tab ?? 'browse',
    expandedGroups: {
      favorites: initial.expandedGroups?.favorites ?? true,
      team_channels: initial.expandedGroups?.team_channels ?? true,
      channels: initial.expandedGroups?.channels ?? true,
      direct_messages: initial.expandedGroups?.direct_messages ?? true,
    },
    collapsedLabels: initial.collapsedLabels ?? [],
    threadsChannelId: initial.threadsChannelId,
    sortBy: {
      team_channels:
        initial.sortBy?.team_channels ?? CHANNELS_DEFAULT_SORT_BY.team_channels,
      channels: initial.sortBy?.channels ?? CHANNELS_DEFAULT_SORT_BY.channels,
      direct_messages:
        initial.sortBy?.direct_messages ??
        CHANNELS_DEFAULT_SORT_BY.direct_messages,
      threads: initial.sortBy?.threads ?? CHANNELS_DEFAULT_SORT_BY.threads,
    },
    sectionPreferences: { ...initial.sectionPreferences },
    sectionOrder: initial.sectionOrder ?? [],
  };
}

function shouldRestorePreferences(initial: ChannelsViewStateOptions): boolean {
  return initial.sortBy === undefined;
}

export const [ChannelsViewProvider, useChannelsView] =
  createAssertedContextProvider<ChannelsViewContext, ChannelsViewProviderProps>(
    'ChannelsView',
    (props) => {
      const panel = useSplitPanelOrThrow();
      const userId = useUserId();
      const navigate = useNavigate();
      const params = useRouteParams(channelDetailRoute);
      const [search, setSearch] = createSearchParams(channelsSearch);
      const sectionsFlag = useFeatureFlag(enableChatSidebarSections);
      const sectionsEnabled = () => sectionsFlag().enabled;
      const threadsFlag = useFeatureFlag(enableChannelThreadsPreview);
      const threadsEnabled = () => threadsFlag().enabled;
      const selectPreview = createPreviewSelectionGuard();
      const initial = props.initialState ?? {};
      const [state, setState] = makePersistedState(
        createStore(createInitialState(initial)),
        createChannelsViewPersistence({
          handle: panel.handle,
          userId,
          restoreEntryState: props.initialState === undefined,
          restoreLocalState: props.initialState === undefined,
          restorePreferences: shouldRestorePreferences(initial),
          restoreSectionOrder: initial.sectionOrder === undefined,
        })
      );

      createEffect(
        on(
          () => search.tab,
          (tab) => {
            if (state.tab !== tab) setState('tab', tab);
          }
        )
      );

      const mobileLayout = () => isTouchDevice();
      const selectedChannel = createMemo<ChannelPreviewSelection | undefined>(
        () => {
          const channelId = params.channelId;
          if (typeof channelId !== 'string') return undefined;
          const target = search.messageId
            ? {
                messageId: search.messageId,
                ...(search.threadId ? { threadId: search.threadId } : {}),
              }
            : undefined;
          return {
            type: 'channel',
            id: channelId,
            ...(target ? { target } : {}),
          };
        }
      );
      const routeSearch = (channel?: ChannelPreviewSelection) => {
        const target = channel && getChannelEntityTarget(channel);
        return channelsSearchCodec.serialize({
          ...channelsSearch.defaults,
          tab: state.tab,
          messageId: target?.kind === 'message' ? target.messageId : '',
          threadId: target?.kind === 'message' ? (target.threadId ?? '') : '',
        });
      };
      const navigateToChannel = (
        channel: ChannelPreviewSelection,
        replace = false
      ) => {
        fireAndForget(
          navigate(
            {
              route: channelDetailRoute,
              params: { channelId: channelIdForPreviewNavigation(channel) },
            },
            {
              replace,
              search: { [channelsSearch.namespace]: routeSearch(channel) },
            }
          ),
          'channels-view'
        );
      };
      const [railRowFocus, setRailRowFocus] =
        createSignal<(channelId: string) => boolean>();
      const registerRailRowFocus = (focus: (channelId: string) => boolean) => {
        setRailRowFocus(() => focus);
        onCleanup(() =>
          setRailRowFocus((current) =>
            current === focus ? undefined : current
          )
        );
      };
      const [composerFocusRequest, setComposerFocusRequest] =
        createSignal<ComposerFocusRequest>();
      let lastComposerFocusRequestId = 0;
      const setSelectedChannel = (
        channel: ChannelPreviewSelection | undefined,
        options: SelectChannelOptions = {}
      ) => {
        if (!channel) {
          setComposerFocusRequest(undefined);
          fireAndForget(
            navigate(
              { route: channelsSplitRoute, params: {} },
              { search: { [channelsSearch.namespace]: routeSearch() } }
            ),
            'channels-view'
          );
          return true;
        }
        if (mobileLayout() || !selectPreview.canSelect(channel)) return false;
        setComposerFocusRequest(
          options.focusComposer
            ? {
                channelId: channelIdForPreviewNavigation(channel),
                id: ++lastComposerFocusRequestId,
              }
            : undefined
        );
        navigateToChannel(channel);
        return true;
      };

      createEffect(
        on(selectedChannel, (channel, previous) => {
          if (!selectPreview(channel)) {
            if (previous) navigateToChannel(previous, true);
            else
              fireAndForget(
                navigate(
                  { route: channelsSplitRoute, params: {} },
                  {
                    replace: true,
                    search: { [channelsSearch.namespace]: routeSearch() },
                  }
                ),
                'channels-view'
              );
          }
        })
      );

      return {
        state,
        mobileLayout,
        selectedChannel,
        composerFocusRequest,
        sectionsEnabled,
        sectionsLoading: () => sectionsFlag().loading,
        threadsEnabled,
        tab: () => {
          if (sectionsEnabled()) return 'browse';
          return state.tab === 'threads' && !threadsEnabled()
            ? 'browse'
            : state.tab;
        },
        threadsChannelId: () => state.threadsChannelId,
        setThreadsChannelId: (channelId) => {
          if (state.threadsChannelId === channelId) return;
          setState('threadsChannelId', channelId);
        },
        setTab: (tab) => {
          if (state.tab === tab) return;
          setState('tab', tab);
          setSearch({ tab });
        },
        setSelectedChannel,
        focusRailRow: (channelId) => railRowFocus()?.(channelId) ?? false,
        registerRailRowFocus,
        setGroupOpen: (group, open) => setState('expandedGroups', group, open),
        setLabelOpen: (labelId, open) =>
          setState('collapsedLabels', (collapsed) =>
            open
              ? collapsed.filter((id) => id !== labelId)
              : collapsed.includes(labelId)
                ? collapsed
                : [...collapsed, labelId]
          ),
        setSortBy: (group, sort) => setState('sortBy', group, sort),
        setSectionPreferences: (section, preferences) =>
          setState('sectionPreferences', (current) => ({
            ...current,
            [section]: { ...current[section], ...preferences },
          })),
        setSectionOrder: (sections) => setState('sectionOrder', sections),
      };
    }
  );
