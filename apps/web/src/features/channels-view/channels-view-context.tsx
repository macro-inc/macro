import { makePersistedState } from '@app/lib/persistence';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createAssertedContextProvider } from '@core/context/createContext';
import { useUserId } from '@core/context/user';
import type { ContextProviderProps } from '@solid-primitives/context';
import { createStore, type Store } from 'solid-js/store';
import { createChannelsViewPersistence } from './persistence';
import type {
  ChannelsGroup,
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
  setSelectedChannelId: (channelId: string | undefined) => void;
  setGroupOpen: (group: ChannelsGroup, open: boolean) => void;
};

export const [ChannelsViewProvider, useChannelsView] =
  createAssertedContextProvider<ChannelsViewContext, ChannelsViewProviderProps>(
    'ChannelsView',
    (props) => {
      const panel = useSplitPanelOrThrow();
      const userId = useUserId();
      const initial = props.initialState ?? {};
      const [state, setState] = makePersistedState(
        createStore<ChannelsViewState>({
          tab: initial.tab ?? 'browse',
          selectedChannelId: initial.selectedChannelId,
          expandedGroups: {
            channels: initial.expandedGroups?.channels ?? true,
            direct_messages: initial.expandedGroups?.direct_messages ?? true,
          },
        }),
        createChannelsViewPersistence({
          handle: panel.handle,
          userId,
          restoreEntryState: props.initialState === undefined,
          restoreLocalState: props.initialState === undefined,
        })
      );

      return {
        state,
        setTab: (tab) => setState('tab', tab),
        setSelectedChannelId: (channelId) =>
          setState('selectedChannelId', channelId),
        setGroupOpen: (group, open) => setState('expandedGroups', group, open),
      };
    }
  );
