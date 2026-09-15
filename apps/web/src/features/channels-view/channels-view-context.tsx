import { makePersistedState } from '@app/lib/persistence';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import type { ContextProviderProps } from '@solid-primitives/context';
import { createStore, type Store } from 'solid-js/store';
import {
  CHANNELS_DEFAULT_RAIL_WIDTH,
  CHANNELS_DEFAULT_SLIM_GROUPS,
  CHANNELS_DEFAULT_SORT_BY,
  clampChannelsRailWidth,
} from './constants';
import { createChannelsViewPersistence } from './persistence';
import type {
  ChannelListSort,
  ChannelsGroup,
  ChannelsQueryScope,
  ChannelsRailMode,
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
  setTab: (tab: ChannelsTab) => void;
  setMobileTab: (tab: ChannelsQueryScope) => void;
  setSelectedChannelId: (channelId: string | undefined) => void;
  setGroupOpen: (group: ChannelsRailSection, open: boolean) => void;
  setSortBy: (group: ChannelsGroup, sort: ChannelListSort) => void;
  setSlimGroupEnabled: (group: ChannelsGroup, enabled: boolean) => void;
  setAsideWidth: (width: number) => void;
  setRailMode: (mode: Exclude<ChannelsRailMode, 'auto'>) => void;
};

function createInitialState(
  initial: ChannelsViewStateOptions
): ChannelsViewState {
  return {
    tab: initial.tab ?? 'browse',
    mobileTab:
      initial.mobileTab ?? (initial.tab === 'recents' ? 'recents' : 'channels'),
    selectedChannelId: initial.selectedChannelId,
    expandedGroups: {
      favorites: initial.expandedGroups?.favorites ?? true,
      channels: initial.expandedGroups?.channels ?? true,
      direct_messages: initial.expandedGroups?.direct_messages ?? true,
    },
    sortBy: {
      channels: initial.sortBy?.channels ?? CHANNELS_DEFAULT_SORT_BY.channels,
      direct_messages:
        initial.sortBy?.direct_messages ??
        CHANNELS_DEFAULT_SORT_BY.direct_messages,
    },
    slimGroups: {
      channels:
        initial.slimGroups?.channels ?? CHANNELS_DEFAULT_SLIM_GROUPS.channels,
      direct_messages:
        initial.slimGroups?.direct_messages ??
        CHANNELS_DEFAULT_SLIM_GROUPS.direct_messages,
    },
    asideWidth: clampChannelsRailWidth(
      initial.asideWidth ?? CHANNELS_DEFAULT_RAIL_WIDTH
    ),
    railMode: initial.railMode ?? 'auto',
  };
}

function shouldRestorePreferences(initial: ChannelsViewStateOptions): boolean {
  return (
    initial.asideWidth === undefined &&
    initial.railMode === undefined &&
    initial.sortBy === undefined &&
    initial.slimGroups === undefined
  );
}

export const [ChannelsViewProvider, useChannelsView] =
  createAssertedContextProvider<ChannelsViewContext, ChannelsViewProviderProps>(
    'ChannelsView',
    (props) => {
      const panel = useSplitPanelOrThrow();
      const userId = useUserId();
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

      return {
        state,
        setTab: (tab) => setState('tab', tab),
        setMobileTab: (tab) => setState('mobileTab', tab),
        setSelectedChannelId: (channelId) =>
          setState('selectedChannelId', channelId),
        setGroupOpen: (group, open) => setState('expandedGroups', group, open),
        setSortBy: (group, sort) => setState('sortBy', group, sort),
        setSlimGroupEnabled: (group, enabled) =>
          setState('slimGroups', group, enabled),
        setAsideWidth: (width) =>
          setState('asideWidth', clampChannelsRailWidth(width)),
        setRailMode: (mode) => setState('railMode', mode),
      };
    }
  );
