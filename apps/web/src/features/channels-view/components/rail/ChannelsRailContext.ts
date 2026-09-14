import type { ListController } from '@app/components/list';
import { createAssertedContextProvider } from '@core/context/createContext';
import type { ChannelEntity } from '@entity';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { ContextProviderProps } from '@solid-primitives/context';
import type { Accessor } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { ChannelsSourceScope, ChannelsSources } from '../../queries';
import type {
  ChannelsGroup,
  ChannelsRailSection,
  ChannelsTab,
} from '../../types';
import type { useChannelRailActivity } from './hooks/useChannelRailActivity';

type ChannelRailActivity = ReturnType<typeof useChannelRailActivity>;

export type ChannelRailRow =
  | {
      kind: 'section';
      id: `section:${ChannelsRailSection}`;
      group: ChannelsRailSection;
    }
  | {
      kind: 'favorite';
      id: `favorite:${string}`;
      group: 'favorites';
      favorite: Favorite;
    }
  | {
      kind: 'conversation';
      id: `channel:${string}`;
      group?: ChannelsGroup;
      scope: ChannelsSourceScope;
      localIndex: number;
      channel: ChannelEntity;
    };

export const rowKeyForChannel = (channelId: string) =>
  `channel:${channelId}` as const;

export const rowKeyForFavorite = (favorite: Favorite) =>
  `favorite:${favorite.entityType}:${favorite.entityId}` as const;

export const rowKeyForSection = (group: ChannelsRailSection) =>
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
  favorites: Accessor<readonly Favorite[]>;
  selectedChannelId: Accessor<string | undefined>;
  isGroupOpen: (group: ChannelsRailSection) => boolean;
  registerRootRef: (element: HTMLDivElement) => void;
  activateRow: (rowId: ChannelRailRow['id']) => void;
  registerScrollRef: (
    group: ChannelsRailSection,
    element: HTMLDivElement
  ) => void;
  registerVirtualizer: (
    scope: ChannelsSourceScope,
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
