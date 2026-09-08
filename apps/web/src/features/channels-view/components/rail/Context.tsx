import { createAssertedContextProvider } from '@core/context/createContext';
import type { ChannelEntity } from '@entity';
import type { ContextProviderProps } from '@solid-primitives/context';
import type { Accessor } from 'solid-js';
import type { ChannelsGroup, ChannelsTab } from '../../types';
import type { ChannelCallStatus } from './Item';

export type ChannelRailContext = {
  mode: Accessor<'full' | 'slim'>;
  tab: Accessor<ChannelsTab>;
  setTab: (tab: ChannelsTab) => void;
  onModeChange: (mode: 'full' | 'slim') => void;
  items: (group: ChannelsGroup) => ChannelEntity[];
  recentConversations: Accessor<ChannelEntity[]>;
  activity: {
    isUnread: (channelId: string) => boolean;
    callStatus: (channelId: string) => ChannelCallStatus | undefined;
    incomingCallId: (channelId: string) => string | undefined;
    unreadCount: (group: ChannelsGroup) => number;
    targetId: (group: ChannelsGroup) => string | undefined;
    label: (group: ChannelsGroup) => string | undefined;
    onVisible: (group: ChannelsGroup, targetId: string) => void;
  };
  item: {
    domId: (channelId: string) => string;
    isSelected: (channelId: string) => boolean;
    isFocused: (channelId: string) => boolean;
    activate: (channelId: string) => void;
  };
  section: {
    domId: (group: ChannelsGroup) => string;
    isOpen: (group: ChannelsGroup) => boolean;
    isFocused: (group: ChannelsGroup) => boolean;
    containsFocus: (group: ChannelsGroup) => boolean;
    activate: (group: ChannelsGroup) => void;
    registerScrollRef: (
      group: ChannelsGroup
    ) => (element: HTMLDivElement) => void;
  };
};

type ChannelRailProviderProps = ContextProviderProps & {
  value: ChannelRailContext;
};

export const [ChannelRailProvider, useChannelRail] =
  createAssertedContextProvider<ChannelRailContext, ChannelRailProviderProps>(
    'ChannelRail',
    (props) => props.value
  );
