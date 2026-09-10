import type { ListController } from '@app/components/list';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { ChannelEntity } from '@entity';
import type { ContextProviderProps } from '@solid-primitives/context';
import type { Accessor } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { ChannelsSources } from '../../queries';
import type {
  ChannelsGroup,
  ChannelsQueryScope,
  ChannelsTab,
} from '../../types';
import type { useChannelRailActivity } from './hooks/useChannelRailActivity';

type ChannelRailActivity = ReturnType<typeof useChannelRailActivity>;

export type ChannelRailRow =
  | {
      kind: 'section';
      id: `section:${ChannelsGroup}`;
      group: ChannelsGroup;
    }
  | {
      kind: 'conversation';
      id: `channel:${string}`;
      group?: ChannelsGroup;
      scope: ChannelsQueryScope;
      localIndex: number;
      channel: ChannelEntity;
    };

export const rowKeyForChannel = (channelId: string) =>
  `channel:${channelId}` as const;

export const rowKeyForSection = (group: ChannelsGroup) =>
  `section:${group}` as const;

export const domIdForRow = (railId: string, rowId: string) =>
  `${railId}-${rowId}`;

export type ChannelsRailContext = {
  railId: string;
  list: ListController<ChannelRailRow>;
  tab: Accessor<ChannelsTab>;
  selectTab: (tab: ChannelsTab) => void;
  setMode: (mode: 'full' | 'slim') => void;
  sources: ChannelsSources;
  selectedChannelId: Accessor<string | undefined>;
  isGroupOpen: (group: ChannelsGroup) => boolean;
  registerRootRef: (element: HTMLDivElement) => void;
  activateRow: (rowId: ChannelRailRow['id']) => void;
  registerScrollRef: (group: ChannelsGroup, element: HTMLDivElement) => void;
  registerVirtualizer: (
    scope: ChannelsQueryScope,
    handle: VirtualizerHandle
  ) => () => void;
  channelActivity: ChannelRailActivity;
};

type ChannelsRailProviderProps = ContextProviderProps & {
  value: ChannelsRailContext;
};

export const [ChannelsRailProvider, useChannelsRail] =
  createAssertedContextProvider<ChannelsRailContext, ChannelsRailProviderProps>(
    'ChannelsRail',
    (props) => props.value
  );
