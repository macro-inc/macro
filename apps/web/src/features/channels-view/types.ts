export type ChannelsTab = 'browse' | 'recents' | 'threads';

export type ChannelsGroup = 'channels' | 'direct_messages';

export type ChannelListSort = 'viewed_at' | 'updated_at' | 'created_at';

/** Lists with their own sort preference: the All tab groups and the Threads rail. */
export type ChannelsSortGroup = ChannelsGroup | 'threads';

/** Collapsible sections of the All tab. */
export type ChannelsRailSection = 'favorites' | ChannelsGroup;

export type ChannelsQueryScope = ChannelsGroup | 'recents';

export type ChannelsViewState = {
  tab: ChannelsTab;
  mobileTab: ChannelsQueryScope;
  expandedGroups: Record<ChannelsRailSection, boolean>;
  /**
   * Channel labels this user has collapsed. Labels themselves are team data;
   * only the open/closed state is personal, so it is stored by label id.
   */
  collapsedLabels: string[];
  /**
   * Threads tab filter: the conversation whose threads are shown, or all.
   * Kept in view state rather than the URL: a search-param change replaces the
   * split's history entry, which is too costly for a per-click filter.
   */
  threadsChannelId: string | undefined;
  sortBy: Record<ChannelsSortGroup, ChannelListSort>;
  asideWidth: number;
};

export type ChannelsViewStateOptions = Partial<
  Omit<ChannelsViewState, 'expandedGroups' | 'sortBy'>
> & {
  expandedGroups?: Partial<ChannelsViewState['expandedGroups']>;
  sortBy?: Partial<ChannelsViewState['sortBy']>;
};
