import { makePersistedState } from '@app/lib/persistence';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ContextProviderProps } from '@solid-primitives/context';
import { createSignal } from 'solid-js';
import { createStore, type Store } from 'solid-js/store';
import {
  CHANNELS_DEFAULT_RAIL_WIDTH,
  CHANNELS_DEFAULT_SORT_BY,
  clampChannelsRailWidth,
} from './constants';
import { createChannelsViewPersistence } from './persistence';
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
  /** The mobile list opens channels in the split; only desktop renders the inline preview. */
  mobileLayout: () => boolean;
  /** Only admitted selections may render an inline preview. */
  previewChannelId: () => string | undefined;
  setTab: (tab: ChannelsTab) => void;
  setMobileTab: (tab: ChannelsQueryScope) => void;
  setSelectedChannelId: (channelId: string | undefined) => void;
  setGroupOpen: (group: ChannelsRailSection, open: boolean) => void;
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

      const mobileLayout = () => isTouchDevice();
      const selectPreview = createPreviewSelectionGuard();
      const [previewChannelId, setPreviewChannelId] = createSignal<string>();
      const setSelectedChannelId = (id: string | undefined) => {
        // The mobile layout keeps the selection for row highlighting only, so
        // there is no preview to claim.
        const preview =
          id && !mobileLayout() ? { type: 'channel' as const, id } : undefined;
        if (!selectPreview(preview)) return;
        setPreviewChannelId(preview?.id);
        setState('selectedChannelId', id);
      };
      // Keep restored selection in persistence even if another view currently
      // owns its preview. It can be retried on selection or the next mount.
      setSelectedChannelId(state.selectedChannelId);

      return {
        state,
        mobileLayout,
        previewChannelId,
        setTab: (tab) => setState('tab', tab),
        setMobileTab: (tab) => setState('mobileTab', tab),
        setSelectedChannelId,
        setGroupOpen: (group, open) => setState('expandedGroups', group, open),
        setSortBy: (group, sort) => setState('sortBy', group, sort),
        setAsideWidth: (width) =>
          setState('asideWidth', clampChannelsRailWidth(width)),
      };
    }
  );
