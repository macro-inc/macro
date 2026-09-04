export type ChannelsTab = 'browse' | 'recents';

export type ChannelsGroup = 'channels' | 'direct_messages';

export type ChannelsViewState = {
  tab: ChannelsTab;
  selectedChannelId?: string;
  expandedGroups: Record<ChannelsGroup, boolean>;
};

export type ChannelsViewStateOptions = Partial<
  Omit<ChannelsViewState, 'expandedGroups'>
> & {
  expandedGroups?: Partial<ChannelsViewState['expandedGroups']>;
};
