export type ChannelsTab = 'browse' | 'recents';

export type ChannelsGroup = 'channels' | 'direct_messages';

export type ChannelListSort = 'viewed_at' | 'updated_at' | 'created_at';

export type ChannelsRailSection = 'favorites' | ChannelsGroup;

export type ChannelsQueryScope = ChannelsGroup | 'recents';

export type ChannelsRailMode = 'auto' | 'full' | 'slim';

export type ChannelsViewState = {
  tab: ChannelsTab;
  mobileTab: ChannelsQueryScope;
  selectedChannelId?: string;
  expandedGroups: Record<ChannelsRailSection, boolean>;
  sortBy: Record<ChannelsGroup, ChannelListSort>;
  slimGroups: Record<ChannelsGroup, boolean>;
  asideWidth: number;
  railMode: ChannelsRailMode;
};

export type ChannelsViewStateOptions = Partial<
  Omit<ChannelsViewState, 'expandedGroups' | 'sortBy' | 'slimGroups'>
> & {
  expandedGroups?: Partial<ChannelsViewState['expandedGroups']>;
  sortBy?: Partial<ChannelsViewState['sortBy']>;
  slimGroups?: Partial<ChannelsViewState['slimGroups']>;
};
