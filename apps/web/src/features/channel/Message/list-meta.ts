export type ChannelMessageListMeta = {
  index: number;
  isNewMessage: boolean;
  isFirstNewMessage: boolean;
  previousTopLevelCreatedAt?: string;
  isGroupedWithPrevious?: boolean;
  /**
   * A later message in this row's sender run owns a thread, so the thread
   * rail passes down through this row to reach it.
   */
  threadRailBelow?: boolean;
  /**
   * True once the oldest page has loaded, so `index === 0` is the true first
   * message in the channel rather than just the oldest currently-loaded one.
   */
  reachedStart?: boolean;
};
