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
  /** Expands the focused message, or collapses it if already expanded. */
  expandFocusedMessage: () => boolean;
  expandAllMessages: () => boolean;
}

type ThreadAction = Exclude<
  keyof EmailThreadKeyboardHandlers,
  | 'cancel'
  | 'isThreadDone'
  | 'canMarkNotDone'
  | 'isThreadMarkedUnread'
  | 'navigateToPreviousMessage'
  | 'navigateToNextMessage'
  | 'expandFocusedMessage'
  | 'expandAllMessages'
>;

/**
 * Keyboard handlers that act on whichever thread `current` returns, so a
 * thread's keys are registered once even though its handlers arrive after it
 * mounts. While `ready` is false the actions are held: their keys are
 * swallowed so they neither act on this thread nor fall through to another.
 * Escape, the state gates, message navigation and expanding messages always
 * pass through, since they only change the view. With no handlers yet, every
 * key falls through.
 */
export function delegateThreadKeyboard(
  current: () => EmailThreadKeyboardHandlers | undefined,
  ready: () => boolean
): EmailThreadKeyboardHandlers {
  const action = (name: ThreadAction) => (): boolean => {
    const handler = current()?.[name];
    if (!handler) return false;
    return ready() ? handler() : true;
  };
  const pass =
    (name: Exclude<keyof EmailThreadKeyboardHandlers, ThreadAction>) =>
    (): boolean =>
      current()?.[name]() ?? false;
  return {
    activate: action('activate'),
    cancel: pass('cancel'),
    replyToFocusedMessage: action('replyToFocusedMessage'),
    replyAllToFocusedMessage: action('replyAllToFocusedMessage'),
    forwardFocusedMessage: action('forwardFocusedMessage'),
    blockSender: action('blockSender'),
    markDone: action('markDone'),
    markNotDone: action('markNotDone'),
    isThreadDone: pass('isThreadDone'),
    canMarkNotDone: pass('canMarkNotDone'),
    markUnread: action('markUnread'),
    markRead: action('markRead'),
    isThreadMarkedUnread: pass('isThreadMarkedUnread'),
    markSenderSignal: action('markSenderSignal'),
    markSenderNoise: action('markSenderNoise'),
    navigateToPreviousMessage: pass('navigateToPreviousMessage'),
    navigateToNextMessage: pass('navigateToNextMessage'),
    expandFocusedMessage: pass('expandFocusedMessage'),
    expandAllMessages: pass('expandAllMessages'),
  };
}
