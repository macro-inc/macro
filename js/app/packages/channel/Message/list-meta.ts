export type ChannelMessageListMeta = {
  index: number;
  isNewMessage: boolean;
  isFirstNewMessage: boolean;
  previousTopLevelCreatedAt?: string;
  isGroupedWithPrevious?: boolean;
  /**
   * True once the oldest page has loaded, so `index === 0` is the true first
   * message in the channel rather than just the oldest currently-loaded one.
   */
  reachedStart?: boolean;
};
