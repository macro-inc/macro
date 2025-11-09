import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { TOKENS } from '@core/hotkey/tokens';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import {
  type ContactInfo,
  isPersonEmailContact,
  recipientEntityMapper,
  useContacts,
  useEmailContacts,
  useOrganizationUsers,
} from '@core/user';
import { createEffectOnEntityTypeNotification } from '@notifications/notificationHelpers';
import { isNotificationWithMetadata } from '@notifications/notificationMetadata';
import { emailClient } from '@service-email/client';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import type { Thread } from '@service-email/generated/schemas/thread';
import { createCallback } from '@solid-primitives/rootless';
import { useSearchParams } from '@solidjs/router';
import { registerHotkey } from 'core/hotkey/hotkeys';
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
import { isScrollingToMessage } from '../signal/scrollState';
import type { createThreadMessagesResource } from '../signal/threadMessages';
import { useThreadNavigation } from '../signal/threadNavigation';
import { registerEmailHotkeys } from '../util/emailHotkeys';
import { getHeaderValue } from '../util/getHeaderValue';
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
  threadMessagesResource: Accessor<ReturnType<
    typeof createThreadMessagesResource
  > | null>;
  threadData: Accessor<Thread | undefined>;
};

export function Email(props: EmailProps) {
  const scopeId = blockHotkeyScopeSignal.get;
  const setIsScrollingToMessage = isScrollingToMessage.set;
  const { navigateThread } = useThreadNavigation();
  const blockElement = blockElementSignal.get;

  const [searchParams] = useSearchParams();
  const targetMessageId = () => searchParams.message_id; // reactive

  const filteredMessages = createMemo(() => {
    return (
      props
        .threadData()
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

  const initialDraftChildren: Record<string, MessageWithBodyReplyless> =
    (() => {
      const t = untrack(() => props.threadData());
      const map: Record<string, MessageWithBodyReplyless> = {};
      if (!t) return map;
      for (const message of t.messages) {
        if (!(message.is_draft && message.body_text?.trim() !== '')) continue;
        const headers = message.headers_json as unknown;
        const parentMessageDbId = getHeaderValue(headers, 'Macro-In-Reply-To');
        if (!parentMessageDbId) continue;
        map[parentMessageDbId] = message;
      }
      return map;
    })();

  const [messageDbIdToDraftChildren, setMessageDbIdToDraftChildren] =
    createStore<Record<string, MessageWithBodyReplyless>>(initialDraftChildren);

  // ============================================
  // SHARED RECIPIENT OPTIONS
  // ============================================
  const organizationUsers = useOrganizationUsers();
  const contacts = useContacts();
  const emailContacts = useEmailContacts();
  const personEmailContacts = emailContacts().filter(isPersonEmailContact);

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

    organizationUsers()
      .map(recipientEntityMapper('user'))
      .forEach((u) => optionsMap.set(u.data.email, u));
    contacts()
      .map(recipientEntityMapper('user'))
      .forEach((u) => optionsMap.set(u.data.email, u));
    personEmailContacts
      .map(recipientEntityMapper('contact'))
      .forEach((c) => optionsMap.set(c.data.email, c));

    const t = props.threadData();
    if (t) {
      const seen = new Map<string, ContactInfo>();
      t.messages.forEach((m) => {
        const add = (c: ContactInfo) => {
          const existing = seen.get(c.email);
          if (!existing || (!existing.name && c.name)) seen.set(c.email, c);
        };
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

  // ============================================
  // SCROLLING LOGIC HELPER FUNCTIONS
  // ============================================

  /**
   * Waits for a resource to finish loading
   */
  const waitForResourceLoad = (
    resource: ReturnType<typeof createThreadMessagesResource>
  ): Promise<void> => {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!resource.loading()) {
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
    targetMessageId: string,
    resource: ReturnType<typeof createThreadMessagesResource>
  ): Promise<boolean> => {
    while (true) {
      const data = resource.resource();

      // Check if message exists in current batch
      const messageExists = data?.thread.messages.some(
        (m: MessageWithBodyReplyless) => m.db_id === targetMessageId
      );

      if (messageExists) return true;

      // No more messages to load
      if (!data?.hasMore) return false;

      // Load next batch and wait
      resource.loadMore();
      await waitForResourceLoad(resource);
    }
  };

  /**
   * Loads one more batch of messages for better scroll context
   * (useful when target message is at the edge of loaded messages)
   */
  const loadContextBatch = async (
    resource: ReturnType<typeof createThreadMessagesResource>
  ): Promise<void> => {
    if (resource.resource()?.hasMore && !resource.loading()) {
      resource.loadMore();
      await waitForResourceLoad(resource);
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
      scrollToLastMessage(container, behavior);
      const lastMessageId = getLastMessageId(messages);
      if (lastMessageId) {
        setFocusedMessageId(lastMessageId);
      }
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
    const resource = props.threadMessagesResource();
    const messageList = messagesRef();
    const containerRef = messagesContainerRef();

    // Skip if dependencies not ready
    if (
      !resource ||
      !messageList ||
      !containerRef ||
      !untrack(() => props.threadData()?.db_id)
    ) {
      return;
    }

    // Skip if still loading or already filled
    if (resource.loading() || untrack(isContainerFilled)) {
      return;
    }

    const messageListHeight = messageList.getBoundingClientRect().height;
    const containerHeight = containerRef.getBoundingClientRect().height;

    // Load more if container isn't filled
    if (messageListHeight < containerHeight) {
      resource.loadMore();
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
    if (untrack(hasHandledTarget)) return;
    const resource = props.threadMessagesResource();
    if (!resource) return;
    // Check if initial loading is complete
    const resourceData = resource.resource();
    const isInitialLoadComplete =
      !!resourceData &&
      (isContainerFilled() || resourceData.hasMore === false) &&
      !resource.loading();

    // Skip if not ready
    if (!isInitialLoadComplete) {
      return;
    }

    // Skip if basic requirements not met
    if (!untrack(() => props.threadData()) || !untrack(() => messagesRef())) {
      return;
    }

    // Mark as handled to prevent re-running
    setHasHandledTarget(true);

    // Check for target message in URL
    const targetMessageId_ = untrack(targetMessageId);
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
    const resource = untrack(() => props.threadMessagesResource());

    if (!resource) return;

    // Case 1: Message not in current loaded batch - need to load more
    if (targetIndex < 0) {
      try {
        const found = await loadMessagesUntilFound(messageId, resource);
        if (found) {
          // Load one more batch for scroll context
          await loadContextBatch(resource);
          // Scroll to the message after DOM updates
          setTimeout(() => performScrollToMessage(messageId, 'smooth'));
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
      await loadContextBatch(resource);
      setTimeout(() => performScrollToMessage(messageId, 'smooth'));
    }
    // Case 3: Message is in current batch with sufficient context
    else {
      setTimeout(() => performScrollToMessage(messageId, 'smooth'));
    }
  }

  const archiveThread = createCallback(() => {
    if (!props.threadData()) return false;
    emailClient.flagArchived({
      value: props.threadData()!.inbox_visible,
      id: props.threadData()!.db_id!,
    });
    navigateThread('down');
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
    registerEmailHotkeys(scopeId(), props.threadData, {
      archiveThread,
      navigateToPreviousMessage,
      navigateToNextMessage,
    });
    registerHotkey({
      hotkey: 'k',
      scopeId: scopeId(),
      description: 'Next email',
      keyDownHandler: () => navigateThread('down'),
      hotkeyToken: TOKENS.email.nextThread,
      displayPriority: 10,
    });

    registerHotkey({
      hotkey: 'j',
      scopeId: scopeId(),
      description: 'Previous email',
      keyDownHandler: () => navigateThread('up'),
      hotkeyToken: TOKENS.email.previousThread,
      displayPriority: 9,
    });
  });

  createEffect(() => {
    // Focus the email block on mount
    if (!blockElement()) return;
    blockElement()?.focus();
  });

  const notificationSource = useGlobalNotificationSource();
  createEffectOnEntityTypeNotification(
    notificationSource,
    'email',
    (notifications) => {
      for (const notification of notifications) {
        if (!isNotificationWithMetadata(notification)) return;
        const metadata = notification.notificationMetadata;
        if (
          !metadata ||
          typeof metadata !== 'object' ||
          !('thread_id' in metadata)
        )
          return;

        const notificationThreadId = (metadata as { thread_id: string })
          .thread_id;

        if (notificationThreadId === props.threadData()?.db_id) {
          const resource = props.threadMessagesResource();
          if (!resource) return;
          resource.refresh();
          break;
        }
      }
    }
  );

  return (
    <EmailProvider
      value={{
        recipientOptions,
        onRecipientsAugment: onRecipientsAugment,
        messageDbIdToDraftChildren,
        setMessageDbIdToDraftChildren,
        messagesRef,
        setMessagesRef: setmessagesRef,
        threadMessagesResource: props.threadMessagesResource,
        focusedMessageId,
        setFocusedMessageId,
        filteredMessages,
        threadData: props.threadData,
      }}
    >
      <EmailFormContextProvider>
        <div class="w-full h-full bg-panel select-none overscroll-none overflow-hidden flex flex-col">
          <TopBar title={props.title()} />
          <div
            class="w-full flex-1 flex flex-col items-center justify-center overflow-hidden"
            ref={setMessagesContainerRef}
          >
            <MessageList
              isScrollingToMessage={isScrollingToMessage.get}
              initialLoadComplete={hasHandledTarget()}
            />
          </div>
          {/* <div class="z-4 absolute left-[44px] bottom-[92px] w-[21px] rounded-bl-xl min-h-[84px] border-l border-b border-edge" /> */}
          <Show when={filteredMessages()?.at(-1)}>
            {(lastMessage) => (
              <div class="w-full flex flex-row justify-center my-2 bg-panel ">
                <EmailInput
                  replyingTo={lastMessage}
                  draft={messageDbIdToDraftChildren[lastMessage().db_id ?? '']}
                />
              </div>
            )}
          </Show>
        </div>
      </EmailFormContextProvider>
    </EmailProvider>
  );
}
