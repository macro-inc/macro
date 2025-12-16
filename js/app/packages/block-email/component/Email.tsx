import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import {
  type ContactInfo,
  recipientEntityMapper,
  useContacts,
} from '@core/user';
import { whenSettled } from '@core/util/whenSettled';
import {
  createEffectOnEntityTypeNotification,
  isNewEmail,
} from '@notifications';
import {
  useArchiveThreadMutation,
  useThreadQuery,
} from '@queries/email/thread';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { createCallback } from '@solid-primitives/rootless';
import { useSearchParams } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { URL_PARAMS } from '../constants';
import { isScrollingToMessage } from '../signal/scrollState';
import { registerEmailHotkeys } from '../util/emailHotkeys';
import {
  getLastMessageId,
  scrollToLastMessage,
  scrollToMessage,
} from '../util/scrollToMessage';
import { EmailProvider, type EmailRecipient } from './EmailContext';
import { EmailFormContextProvider } from './EmailFormContext';
import { EmailInput } from './EmailInput';
import { MessageList } from './MessageList';
import { TopBar } from './TopBar';

type EmailProps = {
  title: Accessor<string>;
  threadId: Accessor<string>;
};

export function Email(props: EmailProps) {
  const scopeId = blockHotkeyScopeSignal.get;

  const setIsScrollingToMessage = isScrollingToMessage.set;
  const blockElement = blockElementSignal.get;
  const {
    unifiedListContext: {
      entitiesSignal: [entities],
      actionRegistry,
    },
  } = useSplitPanelOrThrow();

  const threadQuery = useThreadQuery(props.threadId);
  const threadData = () => threadQuery.data?.thread;
  const hasMore = () => threadQuery.data?.hasMore ?? false;
  const isFetching = () => threadQuery.isFetching;
  const fetchNextPage = () => threadQuery.fetchNextPage();

  const { mutate: archiveThreadMutate } = useArchiveThreadMutation({
    onError: () => {
      toast.failure('Failed to archive thread');
    },
  });

  const [searchParams] = useSearchParams();
  const searchParamsMessageId = () => {
    const messageID = searchParams[URL_PARAMS.messageId];
    if (typeof messageID === 'string') {
      return messageID;
    } else if (Array.isArray(messageID)) {
      return messageID[0];
    }
    return undefined;
  };
  const [targetMessageId, setTargetMessageId] = createSignal<
    string | undefined
  >(searchParamsMessageId());

  const filteredMessages = createMemo(() => {
    return (
      threadData()
        ?.messages.filter((message) => !message.is_draft)
        .sort((a, b) => {
          if (a.internal_date_ts && b.internal_date_ts) {
            return (
              new Date(a.internal_date_ts).getTime() -
              new Date(b.internal_date_ts).getTime()
            );
          }
          // Below is fallback for when internal_date_ts is not set
          else if (a.sent_at && b.sent_at) {
            return (
              new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
            );
          }
          return 0;
        }) ?? []
    );
  });

  // ============================================
  // Map Parent Messages to Draft Children
  // ============================================

  const [messageDbIdToDraftChildren, setMessageDbIdToDraftChildren] =
    createStore<Record<string, MessageWithBodyReplyless>>({});
  const [draftsSettled, setDraftsSettled] = createSignal(false);

  whenSettled(
    threadQuery,
    (data) => {
      const t = data.thread;
      if (!t) return;
      const map: Record<string, MessageWithBodyReplyless> = {};
      for (const message of t.messages) {
        if (!message.is_draft || message.body_text?.trim().length === 0)
          continue;
        const replyingToId = message.replying_to_id;
        if (replyingToId) {
          map[replyingToId] = message;
        }
      }
      setMessageDbIdToDraftChildren(map);
      setDraftsSettled(true);
    },
    (error) => {
      console.error('Failed to load thread data:', error);
      toast.failure('Failed to load email thread. Please try again.');
    }
  );

  // ============================================
  // SHARED RECIPIENT OPTIONS
  // ============================================
  const contacts = useContacts();

  const [augmentedRecipients, setAugmentedRecipients] = createSignal<
    EmailRecipient[]
  >([]);

  function onRecipientsAugment(items: EmailRecipient[]) {
    const existing = augmentedRecipients();
    const existingEmails = new Set(
      existing.map((r) => r.data.email).filter((e) => e.length > 0)
    );

    const uniques: EmailRecipient[] = [];
    for (const r of items) {
      const email = r.data.email;
      if (email && !existingEmails.has(email)) {
        existingEmails.add(email);
        uniques.push(r);
      }
    }

    if (uniques.length === 0) return;
    setAugmentedRecipients([...existing, ...uniques]);
  }

  const recipientOptions = createMemo<EmailRecipient[]>(() => {
    const optionsMap = new Map<string, EmailRecipient>();

    contacts()
      .map(recipientEntityMapper('user'))
      .forEach((u) => optionsMap.set(u.data.email, u));

    const t = threadData();
    if (t) {
      const seen = new Map<string, ContactInfo>();

      const add = (c: ContactInfo) => {
        const existing = seen.get(c.email);
        if (!existing || (!existing.name && c.name)) seen.set(c.email, c);
      };

      t.messages.forEach((m) => {
        m.to.forEach(add);
        m.cc.forEach(add);
        m.bcc.forEach(add);
        if (m.from?.email)
          add({
            email: m.from.email,
            name: m.from.name ?? undefined,
          });
      });
      seen
        .values()
        .map(recipientEntityMapper('contact'))
        .forEach((c) => {
          optionsMap.set(c.data.email, c);
        });
    }

    augmentedRecipients().forEach((r) => {
      const email = r.data.email;
      if (email && !optionsMap.has(email)) optionsMap.set(email, r);
    });

    return Array.from(optionsMap.values());
  });

  const [messagesRef, setmessagesRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);
  const [messagesContainerRef, setMessagesContainerRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);
  const [focusedMessageId, setFocusedMessageId] = createSignal<string>();
  const [isContainerFilled, setIsContainerFilled] = createSignal(false);
  const [hasHandledTarget, setHasHandledTarget] = createSignal(false);
  const [targetMessageActive, setTargetMessageActive] = createSignal(false);

  const activeTargetMessageId = createMemo(() => {
    if (!targetMessageActive()) return undefined;
    return untrack(targetMessageId);
  });

  const blockHandle = blockHandleSignal.get;
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: (params: Record<string, any>) => {
      if (params[URL_PARAMS.messageId]) {
        setTargetMessageId(undefined);
        setTimeout(() => {
          setTargetMessageId(params[URL_PARAMS.messageId]);
          setHasHandledTarget(false);
        }, 0);
      }
    },
  });

  // ============================================
  // SCROLLING LOGIC HELPER FUNCTIONS
  // ============================================

  /**
   * Waits for the query to finish fetching
   */
  const waitForQueryLoad = (): Promise<void> => {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!threadQuery.isFetching) {
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
      const data = threadQuery.data;

      // Check if message exists in current batch
      const messageExists = data?.thread.messages.some(
        (m: MessageWithBodyReplyless) => m.db_id === targetMessageId
      );

      if (messageExists) return true;

      // No more messages to load
      if (!data?.hasMore) return false;

      // Load next batch and wait
      threadQuery.fetchNextPage();
      await waitForQueryLoad();
    }
  };

  /**
   * Loads one more batch of messages for better scroll context
   * (useful when target message is at the edge of loaded messages)
   */
  const loadContextBatch = async (): Promise<void> => {
    if (hasMore() && !isFetching()) {
      fetchNextPage();
      await waitForQueryLoad();
    }
  };

  /**
   * Performs the actual scroll to a message and updates focus
   */
  const performScrollToMessage = (
    messageId: string,
    behavior: ScrollBehavior = 'smooth'
  ) => {
    const messages = untrack(() => filteredMessages());
    const container = untrack(() => messagesRef());

    if (!messages || !container) return false;

    setIsScrollingToMessage(true);
    const success = scrollToMessage(messageId, messages, container, behavior);

    if (success) {
      setFocusedMessageId(messageId);
      // Flash the message after scroll completes
      setTargetMessageActive(true);
      setTimeout(() => {
        setTargetMessageActive(false);
      }, 800);
      // Clear scrolling flag after animation
      setTimeout(() => setIsScrollingToMessage(false), 1000);
    } else {
      setIsScrollingToMessage(false);
    }

    return success;
  };

  /**
   * Scrolls to the last message in the thread
   */
  const scrollToLastMessageAndFocus = (
    behavior: ScrollBehavior = 'instant'
  ) => {
    const container = untrack(() => messagesRef());
    const messages = untrack(() => filteredMessages());
    if (!messages) return;
    if (container && messages.length > 0) {
      // We need to scroll after focus because the scroll needs to account
      // for the size of the message with the focused styling applied
      const lastMessageId = getLastMessageId(messages);
      if (lastMessageId) {
        setFocusedMessageId(lastMessageId);
      }
      queueMicrotask(() => {
        scrollToLastMessage(container, behavior);
      });
    }
  };

  const firstUnreadMessageId = createMemo(() => {
    const messages = filteredMessages()?.sort((a, b) => {
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
  // PHASE 1: ENSURE CONTAINER IS FILLED
  // ============================================
  // This effect ensures we have enough messages to fill the viewport
  // to avoid a sparse UI on initial load
  createEffect(() => {
    const messageList = messagesRef();
    const containerRef = messagesContainerRef();

    // Skip if dependencies not ready
    if (!messageList || !containerRef || !untrack(threadData)?.db_id) {
      return;
    }

    // Skip if still loading or already filled
    if (isFetching() || untrack(isContainerFilled)) {
      return;
    }

    const messageListHeight = messageList.getBoundingClientRect().height;
    const containerHeight = containerRef.getBoundingClientRect().height;

    // Load more if container isn't filled
    if (messageListHeight < containerHeight && hasMore()) {
      fetchNextPage();
    } else {
      setIsContainerFilled(true);
    }
  });

  // ============================================
  // PHASE 2: HANDLE TARGET MESSAGE SCROLLING
  // ============================================
  // This effect handles scrolling to a specific message (if provided via URL) or scrolling to the last message by default
  // This effect should only run once.
  createEffect(() => {
    if (hasHandledTarget()) return;
    const data = threadQuery.data;
    if (!data) return;
    // Check if initial loading is complete
    const isInitialLoadComplete =
      (isContainerFilled() || data.hasMore === false) && !isFetching();

    // Skip if not ready
    if (!isInitialLoadComplete) {
      return;
    }

    // Skip if basic requirements not met
    if (!untrack(threadData) || !untrack(() => messagesRef())) {
      return;
    }

    // Mark as handled to prevent re-running
    setHasHandledTarget(true);

    // Check for target message
    const targetMessageId_ = targetMessageId();
    if (targetMessageId_ && typeof targetMessageId_ !== 'string') return;

    if (targetMessageId_) {
      handleTargetMessage(targetMessageId_);
    } else {
      const lastUnreadMessageId_ = untrack(firstUnreadMessageId);
      // Check if there is an unread message
      if (lastUnreadMessageId_) {
        setTimeout(() =>
          performScrollToMessage(lastUnreadMessageId_!, 'instant')
        );
        setFocusedMessageId(lastUnreadMessageId_!);
      } else {
        // No unread message, scroll to last message
        setTimeout(() => scrollToLastMessageAndFocus('instant'));
      }
    }
  });

  /**
   * Handles scrolling to a specific message ID from URL
   */
  async function handleTargetMessage(messageId: string) {
    const messages = untrack(() => filteredMessages());
    if (!messages) return;
    const targetIndex = messages.findIndex((m) => m.db_id === messageId);

    // Case 1: Message not in current loaded batch - need to load more
    if (targetIndex < 0) {
      try {
        const found = await loadMessagesUntilFound(messageId);
        if (found) {
          // Load one more batch for scroll context
          await loadContextBatch();
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
      await loadContextBatch();
      setTimeout(() => performScrollToMessage(messageId, 'instant'));
    }
    // Case 3: Message is in current batch with sufficient context
    else {
      setTimeout(() => performScrollToMessage(messageId, 'instant'));
    }
  }

  const archiveThread = createCallback(() => {
    const thread = threadData();
    if (!thread?.db_id) return false;
    archiveThreadMutate({
      threadId: thread.db_id,
      archive: thread.inbox_visible,
    });

    if (!props) return false;

    const selectedEntity = entities()?.find(
      (entity) => entity.id === threadData()!.db_id
    );

    if (selectedEntity) {
      actionRegistry.execute('mark_as_done', selectedEntity);
    } else {
      archiveThreadMutate({
        threadId: thread.db_id,
        archive: thread.inbox_visible,
      });
    }

    return true;
  });

  // If there is a focused message id, but it does not currently exist in the message list, it is because the user has just sent a message. When it does come into existence, we want to scroll to the bottom.
  createEffect((prev: boolean | undefined) => {
    const currentFocusedId = focusedMessageId();
    const messages = filteredMessages();
    if (!currentFocusedId || !messages) return true;

    const currentIndex = messages.findIndex(
      (m) => m.db_id === currentFocusedId
    );
    if (currentIndex < 0) return false;

    if (prev === false) {
      setTimeout(() => {
        const container = messagesRef();
        if (container) {
          scrollToLastMessage(container, 'smooth');
        }
      }, 100);
    }
    return true;
  });

  const navigateMessage = createCallback((dir: 'prev' | 'next') => {
    const currentFocusedId = focusedMessageId();
    const messages = filteredMessages();
    const list = messagesRef();
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

    const targetEl = list.children.item(targetIndex) as HTMLDivElement | null;
    targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    targetEl?.focus();
    setFocusedMessageId(targetMsg.db_id);
    return true;
  });

  const navigateToPreviousMessage = createCallback(() =>
    navigateMessage('prev')
  );
  const navigateToNextMessage = createCallback(() => navigateMessage('next'));

  onMount(() => {
    registerEmailHotkeys(scopeId(), threadData, {
      archiveThread,
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
    blockElement()?.focus();
    hasRun = true;
  });

  const notificationSource = useGlobalNotificationSource();

  createEffectOnEntityTypeNotification(
    notificationSource,
    'email',
    (notification) => {
      if (!isNewEmail(notification)) return;
      const notificationThreadId = notification.notificationMetadata.threadId;
      if (notificationThreadId === threadData()?.db_id) {
        threadQuery.refetch();
      }
    }
  );

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

  const refetch = () => threadQuery.refetch();

  return (
    <EmailProvider
      value={{
        recipientOptions,
        onRecipientsAugment: onRecipientsAugment,
        messageDbIdToDraftChildren,
        setMessageDbIdToDraftChildren,
        messagesRef,
        setMessagesRef: setmessagesRef,
        threadId: props.threadId,
        focusedMessageId,
        setFocusedMessageId,
        filteredMessages,
        threadData,
        hasMore,
        isFetching,
        fetchNextPage,
        refetch,
        archiveThread,
        activeTargetMessageId,
        draftsSettled,
      }}
    >
      <EmailFormContextProvider>
        <div class="w-full h-full bg-panel select-none overscroll-none overflow-hidden flex flex-col">
          <TopBar title={props.title()} />
          <div
            class="w-full flex-1 flex flex-col items-center justify-center overflow-hidden"
            ref={setMessagesContainerRef}
          >
            <MessageList initialLoadComplete={hasHandledTarget()} />
          </div>
          {/* <div class="z-4 absolute left-[44px] bottom-[92px] w-[21px] rounded-bl-xl min-h-[84px] border-l border-b border-edge" /> */}
          <Show when={draftsSettled() && filteredMessages()?.at(-1)}>
            {(lastMessage) => (
              <div class="shrink-0 w-full px-4 pb-2">
                <div class="w-full flex flex-row justify-center bg-panel macro-message-width mx-auto">
                  <EmailInput
                    replyingTo={lastMessage}
                    draft={
                      messageDbIdToDraftChildren[lastMessage().db_id ?? '']
                    }
                    markdownDomRef={(el) => {
                      markdownDomRef = el;
                    }}
                  />
                </div>
              </div>
            )}
          </Show>
        </div>
      </EmailFormContextProvider>
    </EmailProvider>
  );
}
