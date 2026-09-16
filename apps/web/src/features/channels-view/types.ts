export type ChannelsTab = 'browse' | 'recents';

export type ChannelsGroup = 'channels' | 'direct_messages';

export type ChannelsRailSection = 'favorites' | ChannelsGroup;

export type ChannelsQueryScope = ChannelsGroup | 'recents';

export type ChannelsRailMode = 'auto' | 'full' | 'slim';

export type ChannelsViewState = {
  tab: ChannelsTab;
  mobileTab: ChannelsQueryScope;
  selectedChannelId?: string;
  expandedGroups: Record<ChannelsRailSection, boolean>;
  asideWidth: number;
  railMode: ChannelsRailMode;
};

export type ChannelsViewStateOptions = Partial<
  Omit<ChannelsViewState, 'expandedGroups'>
> & {
  expandedGroups?: Partial<ChannelsViewState['expandedGroups']>;
};
