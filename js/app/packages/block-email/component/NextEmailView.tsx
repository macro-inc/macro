import {
  NextEmailProvider,
  useNextEmailContext,
} from '@block-email/component/NextEmailContext';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import {
  type Accessor,
  createEffect,
  createMemo,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { isScrollingToMessage } from '../signal/scrollState';
import { registerEmailHotkeys } from '../util/emailHotkeys';
import { getLastMessageId, scrollToMessage } from '../util/scrollToMessage';
import { EmailFormContextProvider } from './EmailFormContext';
import { EmailInput } from './EmailInput';
import { MessageList } from './MessageList';
import { TopBar } from './TopBar';

type NextEmailViewProps = {
  title: Accessor<string>;
  threadId: Accessor<string>;
};

export function NextEmailView(props: NextEmailViewProps) {
  return (
    <NextEmailProvider threadID={props.threadId()}>
      <NextEmailContent {...props} />
    </NextEmailProvider>
  );
}

function NextEmailContent(props: NextEmailViewProps) {
  const scopeId = blockHotkeyScopeSignal.get;

  const setIsScrollingToMessage = isScrollingToMessage.set;
  const blockElement = blockElementSignal.get;

  const context = useNextEmailContext();

  /**
   * Loads messages until the target message is found or no more messages available
   */
  const loadMessagesUntilFound = async (
    targetMessageId: string
  ): Promise<boolean> => {
    while (true) {
      const data = context.thread();

      // Check if message exists in current batch
      const messageExists = data?.messages.some(
        (m: MessageWithBodyReplyless) => m.db_id === targetMessageId
      );

      if (messageExists) return true;

      // No more messages to load
      if (!context.query.hasMore()) return false;

      // Load next batch and wait
      context.query.fetchNextPage();
    }
  };

  /**
   * Loads one more batch of messages for better scroll context
   * (useful when target message is at the edge of loaded messages)
   */
  const fetchNextPage = async (): Promise<void> => {
    if (context.query.hasMore() && !context.query.isFetching()) {
      context.query.fetchNextPage();
    }
  };

  /**
   * Performs the actual scroll to a message and updates focus
   */
  const performScrollToMessage = (
    messageId: string,
    behavior: ScrollBehavior = 'smooth'
  ) => {
    const messages = untrack(() => context.thread()?.messages);
    const container = untrack(context.messagesListRef);

    if (!messages || !container) return false;

    setIsScrollingToMessage(true);
    const success = scrollToMessage(messageId, messages, container, behavior);

    if (success) {
      context.messages.setFocused(messageId);
      // Flash the message after scroll completes
      // setTargetMessageActive(true);
      // setTimeout(() => {
      //   setTargetMessageActive(false);
      // }, 800);
      // Clear scrolling flag after animation
      setTimeout(() => setIsScrollingToMessage(false), 1000);
    } else {
      setIsScrollingToMessage(false);
    }

    return success;
  };

  const scrollToLastMessage = (behavior: ScrollBehavior = 'instant') => {
    const messages = context.messages.list();
    if (!messages?.length) return;

    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) return;

    const container = context.messagesListRef();

    const messageContainer = container?.querySelector(
      `[data-message-id="${lastMessage.db_id}"]`
    );

    messageContainer?.scrollIntoView({ behavior });
  };

  /**
   * Scrolls to the last message in the thread
   */
  const scrollToLastMessageAndFocus = (
    behavior: ScrollBehavior = 'instant'
  ) => {
    const container = untrack(context.messagesListRef);
    const messages = untrack(context.messages.list);
    if (!messages) return;
    if (container && messages.length > 0) {
      // We need to scroll after focus because the scroll needs to account
      // for the size of the message with the focused styling applied
      const lastMessageId = getLastMessageId(messages);
      if (lastMessageId) {
        context.messages.setFocused(lastMessageId);
      }
      queueMicrotask(() => {
        scrollToLastMessage(behavior);
      });
    }
  };

  const firstUnreadMessageId = createMemo(() => {
    const messages = context.messages.list().toSorted((a, b) => {
      if (a.internal_date_ts && b.internal_date_ts) {
        return (
          new Date(a.internal_date_ts).getTime() -
          new Date(b.internal_date_ts).getTime()
        );
      } else if (a.sent_at && b.sent_at) {
        return new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime();
      }
      return 0;
    });
    return messages?.find((m) =>
      m.labels.some((l) => l.provider_label_id === 'UNREAD')
    )?.db_id;
  });

  // ============================================
  // PHASE 2: HANDLE TARGET MESSAGE SCROLLING
  // ============================================
  // This effect handles scrolling to a specific message (if provided via URL) or scrolling to the last message by default
  // This effect should only run once.
  context.onInitialDataLoad(() => {
    // Check for target message
    const targetMessageId_ = context.messages.targetMessageID();

    if (targetMessageId_ && typeof targetMessageId_ !== 'string') return true;

    if (targetMessageId_) {
      handleTargetMessage(targetMessageId_);
    } else {
      const lastUnreadMessageId_ = untrack(firstUnreadMessageId);
      // Check if there is an unread message
      if (lastUnreadMessageId_) {
        setTimeout(() =>
          performScrollToMessage(lastUnreadMessageId_!, 'instant')
        );
        context.messages.setFocused(lastUnreadMessageId_!);
      } else {
        // No unread message, scroll to last message
        scrollToLastMessageAndFocus('instant');
      }
    }

    return true;
  });

  /**
   * Handles scrolling to a specific message ID from URL
   */
  async function handleTargetMessage(messageId: string) {
    const messages = untrack(context.messages.list);
    if (!messages) return;
    const targetIndex = messages.findIndex((m) => m.db_id === messageId);

    // Case 1: Message not in current loaded batch - need to load more
    if (targetIndex < 0) {
      try {
        const found = await loadMessagesUntilFound(messageId);
        if (found) {
          // Load one more batch for scroll context
          await fetchNextPage();
          // Scroll to the message after DOM updates
          setTimeout(() => performScrollToMessage(messageId, 'instant'));
        } else {
          // Message not found, fallback to last message
          setTimeout(() => scrollToLastMessageAndFocus('instant'));
        }
      } catch (error) {
        console.error('Error loading target message:', error);
        setTimeout(() => scrollToLastMessageAndFocus('instant'));
      }
    }
    // Case 2: Message is first in current batch - load more for context
    else if (targetIndex === 0) {
      await fetchNextPage();
      setTimeout(() => performScrollToMessage(messageId, 'instant'));
    }
    // Case 3: Message is in current batch with sufficient context
    else {
      setTimeout(() => performScrollToMessage(messageId, 'instant'));
    }
  }

  // If there is a focused message id, but it does not currently exist in the message list, it is because the user has just sent a message. When it does come into existence, we want to scroll to the bottom.
  createEffect((prev: boolean | undefined) => {
    const currentFocusedId = context.messages.focusedID();
    const messages = context.messages.list();

    if (!currentFocusedId || !messages) return true;

    const currentIndex = messages.findIndex(
      (m) => m.db_id === currentFocusedId
    );
    if (currentIndex < 0) return false;

    if (prev === false) {
      setTimeout(() => {
        scrollToLastMessage('smooth');
      }, 100);
    }
    return true;
  });

  const navigateMessage = createCallback((dir: 'prev' | 'next') => {
    const currentFocusedId = context.messages.focusedID();
    const messages = context.messages.list();
    const list = context.messagesListRef();
    if (!currentFocusedId || !messages || !list) return false;

    const currentIndex = messages.findIndex(
      (m) => m.db_id === currentFocusedId
    );
    if (currentIndex < 0) return false;

    const delta = dir === 'prev' ? -1 : 1;
    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= messages.length) return false;

    const targetMsg = messages[targetIndex];

    if (!targetMsg?.db_id) return false;

    const targetEl = list.children.item(
      messages.length - 1 - targetIndex
    ) as HTMLDivElement | null;
    targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    targetEl?.focus();
    context.messages.setFocused(targetMsg.db_id);
    return true;
  });

  const navigateToPreviousMessage = () => navigateMessage('prev');
  const navigateToNextMessage = () => navigateMessage('next');

  onMount(() => {
    registerEmailHotkeys(scopeId(), context.thread, {
      archiveThread: context.archiveThread,
      navigateToPreviousMessage,
      navigateToNextMessage,
    });
  });

  // In preview mode, switching between Soup tabs was causing this createEffect to overflow the stack. We should figure out that root cause, this flag fixes it for now.
  let hasRun = false;
  createEffect(() => {
    if (hasRun) return;
    // Focus the email block on mount
    if (!blockElement()) return;
    // blockElement()?.focus();
    hasRun = true;
  });

  let markdownDomRef!: HTMLDivElement;

  registerScopeSignalHotkey(scopeId, {
    hotkey: 'enter',
    description: 'Focus Email Input',
    keyDownHandler: () => {
      if (markdownDomRef) {
        markdownDomRef.focus();
        return true;
      }
      return false;
    },
    hotkeyToken: TOKENS.block.focus,
    hide: true,
  });

  return (
    <EmailFormContextProvider>
      <div class="w-full h-full bg-panel select-none overscroll-none overflow-hidden flex flex-col">
        <TopBar title={props.title()} />
        <div
          class="w-full flex-1 flex flex-col items-center overflow-hidden"
          ref={context.registerMessagesContainer}
        >
          <MessageList initialLoadComplete={context.initialLoadComplete()} />
        </div>
        <Show
          when={
            context.drafts.initialDraftsSettled() &&
            context.messages.list().at(-1)
          }
        >
          {(lastMessage) => {
            return (
              <div class="shrink-0 w-full px-4 pb-2">
                <div class="w-full flex flex-row justify-center bg-panel macro-message-width mx-auto">
                  <EmailInput
                    replyingTo={lastMessage}
                    draft={
                      lastMessage().db_id
                        ? context.drafts.getDraftForMessage(
                            lastMessage().db_id!
                          )
                        : undefined
                    }
                    markdownDomRef={(el) => {
                      markdownDomRef = el;
                    }}
                  />
                </div>
              </div>
            );
          }}
        </Show>
      </div>
    </EmailFormContextProvider>
  );
}
