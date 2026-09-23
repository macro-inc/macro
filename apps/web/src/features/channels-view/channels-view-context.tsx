import {
  type ChannelPreviewSelection,
  getChannelEntityTarget,
} from '@app/features/next-soup/utils';
import { makePersistedState } from '@app/lib/persistence';
import {
  createSearchParams,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ContextProviderProps } from '@solid-primitives/context';
import { type Accessor, createEffect, createMemo, on } from 'solid-js';
import { createStore, type Store } from 'solid-js/store';
import {
  CHANNEL_DETAIL_SEARCH_NAMESPACE,
  channelDetailSearch,
  channelDetailSearchCodec,
  channelsTabSearch,
  channelsTabSearchCodec,
} from './channels-route';
import {
  CHANNELS_DEFAULT_RAIL_WIDTH,
  CHANNELS_DEFAULT_SORT_BY,
  clampChannelsRailWidth,
} from './constants';
import { createChannelsViewPersistence } from './persistence';
import { channelDetailRoute, channelsSplitRoute } from './route';
import type {
  ChannelListSort,
  ChannelsGroup,
  ChannelsQueryScope,
  ChannelsRailSection,
  ChannelsTab,
  ChannelsViewState,
  ChannelsViewStateOptions,
} from './types';

type ChannelsViewProviderProps = ContextProviderProps & {
  initialState?: ChannelsViewStateOptions;
};

export type ChannelsViewContext = {
  state: Store<ChannelsViewState>;
  /** The mobile list opens channels in the split; only desktop renders detail. */
  mobileLayout: () => boolean;
  selectedChannel: Accessor<ChannelPreviewSelection | undefined>;
  setTab: (tab: ChannelsTab) => void;
  setMobileTab: (tab: ChannelsQueryScope) => void;
  setSelectedChannel: (channel: ChannelPreviewSelection | undefined) => boolean;
  setGroupOpen: (group: ChannelsRailSection, open: boolean) => void;
  /** Per-user collapse state of a team channel label. */
  setLabelOpen: (labelId: string, open: boolean) => void;
  setSortBy: (group: ChannelsGroup, sort: ChannelListSort) => void;
  setAsideWidth: (width: number) => void;
};

function createInitialState(
  initial: ChannelsViewStateOptions
): ChannelsViewState {
  return {
    tab: initial.tab ?? 'browse',
    mobileTab:
      initial.mobileTab ?? (initial.tab === 'recents' ? 'recents' : 'channels'),
    expandedGroups: {
      favorites: initial.expandedGroups?.favorites ?? true,
      channels: initial.expandedGroups?.channels ?? true,
      direct_messages: initial.expandedGroups?.direct_messages ?? true,
    },
    collapsedLabels: initial.collapsedLabels ?? [],
    sortBy: {
      channels: initial.sortBy?.channels ?? CHANNELS_DEFAULT_SORT_BY.channels,
      direct_messages:
        initial.sortBy?.direct_messages ??
        CHANNELS_DEFAULT_SORT_BY.direct_messages,
    },
    asideWidth: clampChannelsRailWidth(
      initial.asideWidth ?? CHANNELS_DEFAULT_RAIL_WIDTH
    ),
  };
}

function shouldRestorePreferences(initial: ChannelsViewStateOptions): boolean {
  return initial.asideWidth === undefined && initial.sortBy === undefined;
}

export const [ChannelsViewProvider, useChannelsView] =
  createAssertedContextProvider<ChannelsViewContext, ChannelsViewProviderProps>(
    'ChannelsView',
    (props) => {
      const panel = useSplitPanelOrThrow();
      const userId = useUserId();
      const navigate = useNavigate();
      const params = useRouteParams(channelDetailRoute);
      const [detailSearch] = createSearchParams(channelDetailSearch);
      const [tabSearch, setTabSearch] = createSearchParams(channelsTabSearch);
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
        })
      );

      createEffect(
        on(
          () => [tabSearch.tab, tabSearch.mobileTab] as const,
          ([tab, mobileTab]) => {
            if (state.tab !== tab) setState('tab', tab);
            if (state.mobileTab !== mobileTab) setState('mobileTab', mobileTab);
          }
        )
      );

      const mobileLayout = () => isTouchDevice();
      const selectedChannel = createMemo<ChannelPreviewSelection | undefined>(
        () => {
          const channelId = params.channelId;
          if (typeof channelId !== 'string') return undefined;
          const target = detailSearch.messageId
            ? {
                messageId: detailSearch.messageId,
                ...(detailSearch.threadId
                  ? { threadId: detailSearch.threadId }
                  : {}),
              }
            : undefined;
          return {
            type: 'channel',
            id: channelId,
            ...(target ? { target } : {}),
          };
        }
      );
      const routeSearch = (channel: ChannelPreviewSelection) => {
        const target = getChannelEntityTarget(channel);
        const value = {
          messageId: target?.kind === 'message' ? target.messageId : '',
          threadId: target?.kind === 'message' ? (target.threadId ?? '') : '',
        };
        return channelDetailSearchCodec.serialize(value);
      };
      const navigateToChannel = (
        channel: ChannelPreviewSelection,
        replace = false
      ) => {
        const channelId =
          channel.type === 'channel' ? channel.id : channel.channelId;
        navigate(
          { route: channelDetailRoute, params: { channelId } },
          {
            replace,
            search: {
              [CHANNEL_DETAIL_SEARCH_NAMESPACE]: routeSearch(channel),
              [channelsTabSearch.namespace]: channelsTabSearchCodec.serialize({
                tab: state.tab,
                mobileTab: state.mobileTab,
              }),
            },
          }
        );
      };
      const setSelectedChannel = (
        channel: ChannelPreviewSelection | undefined
      ) => {
        if (!channel) {
          navigate(
            { route: channelsSplitRoute, params: {} },
            {
              search: {
                [channelsTabSearch.namespace]: channelsTabSearchCodec.serialize(
                  {
                    tab: state.tab,
                    mobileTab: state.mobileTab,
                  }
                ),
              },
            }
          );
          return true;
        }
        if (mobileLayout() || !selectPreview.canSelect(channel)) return false;
        navigateToChannel(channel);
        return true;
      };

      createEffect(
        on(selectedChannel, (channel, previous) => {
          if (!selectPreview(channel)) {
            if (previous) navigateToChannel(previous, true);
            else
              navigate(
                { route: channelsSplitRoute, params: {} },
                {
                  replace: true,
                  search: {
                    [channelsTabSearch.namespace]:
                      channelsTabSearchCodec.serialize({
                        tab: state.tab,
                        mobileTab: state.mobileTab,
                      }),
                  },
                }
              );
          }
        })
      );

      return {
        state,
        mobileLayout,
        selectedChannel,
        setTab: (tab) => {
          if (state.tab === tab) return;
          setState('tab', tab);
          setTabSearch({ tab });
        },
        setMobileTab: (mobileTab) => {
          if (state.mobileTab === mobileTab) return;
          setState('mobileTab', mobileTab);
          setTabSearch({ mobileTab });
        },
        setSelectedChannel,
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
        setAsideWidth: (width) =>
          setState('asideWidth', clampChannelsRailWidth(width)),
      };
    }
  );
