export type ChannelsTab = 'browse' | 'recents';

export type ChannelsGroup = 'channels' | 'direct_messages';

export type ChannelsViewState = {
  tab: ChannelsTab;
  selectedChannelId?: string;
  expandedGroups: Record<ChannelsGroup, boolean>;
  asideWidth: number;
};

export type ChannelsViewStateOptions = Partial<
  Omit<ChannelsViewState, 'expandedGroups'>
> & {
  expandedGroups?: Partial<ChannelsViewState['expandedGroups']>;
};
