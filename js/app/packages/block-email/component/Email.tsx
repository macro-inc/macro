import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { EmailCompose } from '@block-email/component/compose/Compose';
import {
  EmailProvider,
  useEmailContext,
} from '@block-email/component/EmailContext';
import { EmailInput } from '@block-email/component/EmailInput';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { FloatingInputLoader } from '@core/component/FloatingInputLoader';
import { useUserContext } from '@core/context/user';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  Match,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { isScrollingToMessage } from '../signal/scrollState';
import { registerEmailHotkeys } from '../util/emailHotkeys';
import { scrollToMessage } from '../util/scrollToMessage';
import { BottomReplyButtons } from './BottomReplyButtons';
import { EmailFormContextProvider } from './EmailFormContext';
import { EmailParticipants } from './EmailParticipants';
import { MessageList } from './MessageList';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

const TARGET_MESSAGE_HIGHLIGHT_MS = 800;
const SCROLL_ANIMATION_MS = 1000;
const SCROLL_AFTER_SEND_DELAY_MS = 100;

type EmailViewProps = {
  title: string;
  threadId: Accessor<string>;
};

export function EmailView(props: EmailViewProps) {
  return (
    <EmailProvider threadID={props.threadId()}>
      <EmailContent {...props} />
    </EmailProvider>
  );
}

function EmailContent(props: EmailViewProps) {
  const scopeId = blockHotkeyScopeSignal.get;

  const setIsScrollingToMessage = isScrollingToMessage.set;
  const blockElement = blockElementSignal.get;

  const context = useEmailContext();
  const splitPanel = useSplitPanel();
  const { isLoading: isUserLoading } = useUserContext();

  const [isScrolled, setIsScrolled] = createSignal(false);

  const handleScrollPositionChange = (scrollFromTop: number) => {
    setIsScrolled(scrollFromTop > 1);
  };

  /**
   * Waits for the query to finish fetching
   */
  const waitForQueryLoad = (): Promise<void> => {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!context.query.isFetching()) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
  };

  /**
   * Loads messages until the target message is found or no more messages available
   */
  const loadMessagesUntilFound = async (
    targetMessageId: string
  ): Promise<boolean> => {
    while (true) {
      const messages = context.messages.unfiltered();

      // Check if message exists in current batch
      const messageExists = messages.some(
        (m: ApiMessage) => m.db_id === targetMessageId
      );

      if (messageExists) return true;

      // No more messages to load
      if (!context.query.hasMore()) return false;

      // Load next batch and wait
      context.query.fetchNextPage();
      await waitForQueryLoad();
    }
  };

  /**
   * Loads the next page only when there is more data to load and
   * it's not already fetching
   */
  const fetchNextPage = () => {
    if (context.query.hasMore() && !context.query.isFetching()) {
      context.query.fetchNextPage();
    }
  };

  /**
   * Performs scrolling to a message and updates focus.
   */
  const performScrollToMessage = (
    messageId: string,
    opts: { behavior?: ScrollBehavior; focus?: boolean } = {
      behavior: 'smooth',
      focus: true,
    }
  ) => {
    opts = { focus: true, behavior: 'smooth', ...opts };
    const messages = untrack(context.messages.list);
    const container = untrack(context.messagesListRef);

    if (!messages || !container) return false;

    if (opts.focus) {
      context.messages.setFocused(messageId);
    }

    setIsScrollingToMessage(true);

    const success = scrollToMessage(messageId, messages, container, {
      behavior: opts.behavior,
      reversed: true,
    });

    if (!success) {
      setIsScrollingToMessage(false);
      return false;
    }

    if (context.messages.targetMessageID() === messageId) {
      setTimeout(() => {
        context.messages.setTargetMessageID(undefined);
      }, TARGET_MESSAGE_HIGHLIGHT_MS);
    }

    // Clear scrolling flag after animation
    setTimeout(() => setIsScrollingToMessage(false), SCROLL_ANIMATION_MS);

    return true;
  };

  const scrollToLastMessage = (
    behavior: ScrollBehavior = 'instant',
    focus = false
  ) => {
    const messages = context.messages.list();
    if (!messages?.length) return;

    const lastMessage = messages[messages.length - 1];

    if (!lastMessage.db_id) return;

    performScrollToMessage(lastMessage.db_id, { behavior, focus });
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

  const canRunInitialEmailScroll = () =>
    !isTouchDevice() || splitPanel?.isPanelActive() !== false;

  // ============================================
  // PHASE 2: HANDLE TARGET MESSAGE SCROLLING
  // ============================================
  // This effect handles scrolling to a specific message (if provided via URL) or scrolling to the last message by default
  // This effect should only run once.
  context.onInitialDataLoad(() => {
    // Initial scroll positioning visibly shifts the email panel if it runs
    // while the split is swiping in on touch devices.
    if (!canRunInitialEmailScroll()) return false;

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
          performScrollToMessage(lastUnreadMessageId_!, {
            behavior: 'instant',
          })
        );
        context.messages.setFocused(lastUnreadMessageId_!);
      } else {
        scrollToLastMessage('instant', false);
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
          fetchNextPage();
          await waitForQueryLoad();
          // Scroll to the message after DOM updates
          setTimeout(() =>
            performScrollToMessage(messageId, { behavior: 'instant' })
          );
        } else {
          // Message not found, fallback to last message
          setTimeout(() => scrollToLastMessage('instant', true));
        }
      } catch (error) {
        console.error('Error loading target message:', error);
        setTimeout(() => scrollToLastMessage('instant', true));
      }
    }
    // Case 2: Message is first in current batch - load more for context
    else if (targetIndex === 0) {
      fetchNextPage();
      await waitForQueryLoad();
      setTimeout(() =>
        performScrollToMessage(messageId, { behavior: 'instant' })
      );
    }

    // Case 3: Message is in current batch with sufficient context
    setTimeout(() =>
      performScrollToMessage(messageId, { behavior: 'instant' })
    );
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
      }, SCROLL_AFTER_SEND_DELAY_MS);
    }
    return true;
  });

  const navigateMessage = createCallback((dir: 'prev' | 'next') => {
    const messages = context.messages.list();
    const list = context.messagesListRef();
    if (!messages?.length || !list) return false;

    const currentFocusedId = context.messages.focusedID();

    if (!currentFocusedId) {
      const target =
        dir === 'prev' ? messages[messages.length - 1] : messages[0];
      if (!target?.db_id) return false;
      performScrollToMessage(target.db_id, {
        behavior: 'smooth',
        focus: true,
      });
      return true;
    }

    const currentIndex = messages.findIndex(
      (m) => m.db_id === currentFocusedId
    );
    if (currentIndex < 0) return false;

    const delta = dir === 'prev' ? -1 : 1;
    const targetIndex = currentIndex + delta;

    if (targetIndex < 0 || targetIndex >= messages.length) {
      if (dir === 'next' && markdownDomRef) {
        context.messages.setFocused(undefined);
        markdownDomRef.focus();
        return true;
      }
      return false;
    }

    const targetMsg = messages[targetIndex];
    if (!targetMsg?.db_id) return false;

    performScrollToMessage(targetMsg.db_id, {
      behavior: 'smooth',
      focus: true,
    });

    return true;
  });

  const navigateToPreviousMessage = () => navigateMessage('prev');
  const navigateToNextMessage = () => navigateMessage('next');

  onMount(() => {
    registerEmailHotkeys(scopeId(), {
      blockSender: context.blockSender,
      markSenderSignal: context.markSenderSignal,
      markSenderNoise: context.markSenderNoise,
      navigateToPreviousMessage,
      navigateToNextMessage,
    });
  });

  // In preview mode, switching between Soup tabs was causing this createEffect to overflow the stack. We should figure out that root cause, this flag fixes it for now.
  let hasRun = false;
  createEffect(() => {
    if (hasRun) return;
    // Focus the email block on mount
    if (isTouchDevice()) return;
    if (!blockElement()) return;
    blockElement()?.focus({ preventScroll: true });
    hasRun = true;
  });

  let markdownDomRef!: HTMLDivElement;

  registerScopeSignalHotkey(scopeId, {
    hotkey: 'enter',
    description: 'Focus Email Input',
    keyDownHandler: () => {
      const focusedId = context.messages.focusedID();

      // If a message is focused and collapsed, expand it
      if (focusedId && !context.messages.isBodyExpanded(focusedId)) {
        context.messages.setExpandedBodyId(focusedId, true);
        return true;
      }

      // If message is expanded and not the last message, trigger reply to that message
      if (focusedId && context.messages.isBodyExpanded(focusedId)) {
        const messages = context.messages.list();
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.db_id !== focusedId) {
          context.messages.setReplyingToMessageId(focusedId);
          return true;
        }
      }

      // Otherwise, focus the main email input
      if (markdownDomRef) {
        markdownDomRef.focus();
        return true;
      }
      return false;
    },
    hotkeyToken: TOKENS.block.focus,
    hide: true,
  });

  registerScopeSignalHotkey(scopeId, {
    hotkey: 'escape',
    description: 'Collapse message',
    keyDownHandler: () => {
      // Skip if focus is in an editable area (compose input handles its own Escape)
      const activeEl = document.activeElement;
      if (
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.getAttribute('contenteditable') === 'true'
      ) {
        return false;
      }

      const focusedId = context.messages.focusedID();
      if (!focusedId) return false;

      // If there's an active reply, just clear it (don't collapse the message)
      if (context.messages.replyingToMessageId() === focusedId) {
        context.messages.setReplyingToMessageId(undefined);
        return true;
      }

      // If message is expanded and not the last message, collapse it
      if (context.messages.isBodyExpanded(focusedId)) {
        const messages = context.messages.list();
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.db_id !== focusedId) {
          context.messages.setExpandedBodyId(focusedId, false);
          return true;
        }
      }
      return false;
    },
    hotkeyToken: TOKENS.email.cancelReply,
    hide: true,
  });

  // On thread change: collapse the bottom reply, then re-evaluate auto-open
  // for the current thread's last message. Single effect to avoid an
  // ordering race between separate "reset on thread change" and "auto-open
  // on draft" effects (Solid runs effects in declaration order on first
  // mount, which can let the reset clobber the auto-open if both data
  // sources are synchronously available).
  let prevThreadId: string | undefined;
  createEffect(() => {
    const tid = props.threadId();
    if (prevThreadId !== tid) {
      prevThreadId = tid;
      context.messages.setBottomReplyOpen(false);
    }
    const filtered = context.messages.list();
    const lastMessage = filtered.at(-1);
    if (!lastMessage?.db_id) return;
    if (context.drafts.getDraftForMessage(lastMessage.db_id)) {
      context.messages.setBottomReplyOpen(true);
    }
  });

  const emailReplyInfo = createMemo(() => {
    const filtered = context.messages.list();

    // If there are non draft messages in this thread, the bottom input will
    // be for sending a reply to the last message
    if (filtered.length !== 0) {
      const lastMessage = filtered.at(-1);
      if (!lastMessage || !lastMessage.db_id) return;
      return {
        replyingTo: lastMessage,
        draft: context.drafts.getDraftForMessage(lastMessage.db_id),
      };
    }

    // Otherwise, if the other messages in the thread are drafts,
    // the bottom input will be for editing and sending the latest/last draft
    const unfiltered = context.messages.unfiltered();

    if (unfiltered.length === 0) return;

    const latest = unfiltered.at(-1);

    if (!latest || !latest.is_draft) return;

    return { replyingTo: undefined, draft: latest };
  });

  return (
    <ModalsProvider subject={props.title}>
      <Show when={!isUserLoading()}>
        <Switch>
          <Match
            when={
              emailReplyInfo()?.replyingTo == null &&
              emailReplyInfo()?.draft?.db_id != null &&
              emailReplyInfo()?.draft
            }
          >
            {(draft) => <EmailCompose draftID={draft().db_id!} />}
          </Match>

          <Match when={true}>
            <EmailFormContextProvider
              formOptions={{
                getMessageByID: (id) =>
                  context.messages.unfiltered().find((m) => m.db_id === id),
                getDraftForMessageReply: context.drafts.getDraftForMessage,
                onRecipientsChange: context.onRecipientsChange,
              }}
            >
              <div class="size-full bg-surface select-none overscroll-none overflow-hidden flex flex-col">
                <TopBar
                  id={props.threadId()}
                  title={props.title}
                  isDraft={
                    emailReplyInfo()?.replyingTo == null &&
                    emailReplyInfo()?.draft !== null
                  }
                />
                <div
                  class="w-full flex-1 flex flex-col items-center overflow-hidden"
                  ref={context.registerMessagesContainer}
                >
                  <Show when={!isMobile()}>
                    <div class="shrink-0 w-full flex justify-center">
                      <div
                        class="macro-message-width macro-message-padding w-full border-b"
                        classList={{
                          'border-edge-muted/50': isScrolled(),
                          'border-transparent': !isScrolled(),
                        }}
                      >
                        <h1 class="ph-no-capture text-2xl font-semibold text-ink pt-3 pb-1.5 tracking-tight text-balance">
                          {props.title}
                        </h1>
                        <div class="pb-2.5">
                          <EmailParticipants />
                        </div>
                      </div>
                    </div>
                  </Show>
                  <MessageList
                    initialLoadComplete={context.initialLoadComplete()}
                    onScrollPositionChange={handleScrollPositionChange}
                    title={props.title}
                  />
                  <CustomScrollbar
                    reverse
                    scrollContainer={context.messagesListRef}
                  />
                </div>
                <Show
                  when={
                    context.permissions().isOwner &&
                    context.drafts.initialDraftsSettled() &&
                    emailReplyInfo()
                  }
                >
                  {(info) => (
                    <div class="shrink-0 w-full pb-4">
                      <div class="relative w-full flex flex-row justify-center bg-surface macro-message-width macro-message-padding mx-auto">
                        <FloatingInputLoader
                          isLoading={context.query.isFetching}
                          loadingText="Loading messages"
                        />
                        <Show
                          when={
                            context.messages.bottomReplyOpen() ||
                            info().replyingTo == null
                          }
                          fallback={
                            <Show when={info().replyingTo}>
                              {(lastMessage) => (
                                <BottomReplyButtons
                                  lastMessage={lastMessage()}
                                />
                              )}
                            </Show>
                          }
                        >
                          <EmailInput
                            replyingTo={() => info().replyingTo}
                            draft={info().draft}
                            setShowReply={(v) => {
                              const next =
                                typeof v === 'function'
                                  ? v(context.messages.bottomReplyOpen())
                                  : v;
                              context.messages.setBottomReplyOpen(next);
                            }}
                            markdownDomRef={(el) => {
                              markdownDomRef = el;
                            }}
                          />
                        </Show>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
            </EmailFormContextProvider>
          </Match>
        </Switch>
      </Show>
    </ModalsProvider>
  );
}
