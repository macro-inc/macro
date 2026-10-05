export interface EmailThreadKeyboardHandlers {
  activate: () => boolean;
  cancel: () => boolean;
  replyToFocusedMessage: () => boolean;
  replyAllToFocusedMessage?: () => boolean;
  forwardFocusedMessage: () => boolean;
  blockSender: () => boolean;
  markDone: () => boolean;
  markNotDone: () => boolean;
  /** Gates which of Mark done / Mark as not done is active. */
  isThreadDone: () => boolean;
  /** Whether the done state can be reversed at all — false for threads that
   *  are structurally done (no inbound message), where Mark as not done is a
   *  no-op. */
  canMarkNotDone: () => boolean;
  markUnread: () => boolean;
  markRead: () => boolean;
  /** Gates which of Mark as unread / Mark as read is active. */
  isThreadMarkedUnread: () => boolean;
  markSenderSignal: () => boolean;
  markSenderNoise: () => boolean;
  navigateToPreviousMessage: () => boolean;
  navigateToNextMessage: () => boolean;
  /** Expand/collapse the focused message. Returns true if the focused message
   *  state was changed, false if no message is focused or the operation failed. */
  expandFocusedMessage?: () => boolean;
  /** Expand all messages in the thread. */
  expandAllMessages?: () => boolean;
  /** Toggle star/favorite on the thread. */
  toggleStar?: () => boolean;
  /** Check if the thread is starred/favorited. */
  isThreadStarred?: () => boolean;
  /** Trash the thread. */
  trashThread?: () => boolean;
  /** Mute the thread. */
  muteThread?: () => boolean;
  /** Check if the thread is muted. */
  isThreadMuted?: () => boolean;
}
