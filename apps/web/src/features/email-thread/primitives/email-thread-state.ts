import type { Accessor } from 'solid-js';
import { createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { EmailRecipient } from '../../email-compose/core/email-recipient';
import { convertContactInfoToEmailRecipient } from '../../email-compose/core/recipient-conversion';
import type { ReplyType } from '../../email-compose/core/reply-type';
import type {
  EmailContact,
  EmailMessage,
} from '../../email-message/core/email-message';
import type {
  ArchiveThreadOptions,
  EmailThreadDependencies,
  EmailThreadHost,
} from '../context/email-thread-dependencies';
import type { EmailThread } from '../core/email-thread';
import { selectThreadMessages } from '../core/thread-messages';
import type { HoveredThreadStop } from '../core/thread-stops';
import { hiddenMessagesControl } from './scroll-to-message';
import { createThreadSnapshot } from './thread-snapshot';
export type EmailThreadState = {
  isScrollingToMessage: Accessor<boolean>;
  setIsScrollingToMessage: (value: boolean) => void;
  registerMessagesList: (list: HTMLElement) => void;
  messagesListRef: Accessor<HTMLElement | undefined>;
  registerMessagesContainer: (container: HTMLElement) => void;
  messagesContainerRef: Accessor<HTMLElement | undefined>;

  recipientOptions: Accessor<EmailRecipient[]>;
  onRecipientsChange: (items: EmailRecipient[]) => void;

  drafts: {
    getDraftForMessage: (messageDbID: string) => EmailMessage | undefined;
    deleteDraftForMessage: (messageDbID: string) => void;
    initialDraftsSettled: Accessor<boolean>;
  };

  messages: {
    unfiltered: Accessor<EmailMessage[]>;
    list: Accessor<EmailMessage[]>;
    targetMessageID: Accessor<string | undefined>;
    setTargetMessageID: (id: string | undefined) => void;
    focusedID: Accessor<string | undefined>;
    setFocused: (messageID: string | undefined) => void;
    hiddenChipFocused: Accessor<boolean>;
    setHiddenChipFocused: (focused: boolean) => void;
    hovered: Accessor<HoveredThreadStop | undefined>;
    setHovered: (stop: HoveredThreadStop | undefined) => void;
    expandedBodyIds: Record<string, boolean>;
    setExpandedBodyId: (id: string, expanded: boolean) => void;
    isBodyExpanded: (id: string) => boolean;
    replyingToMessageId: Accessor<string | undefined>;
    setReplyingToMessageId: (id: string | undefined) => void;
    bottomReplyOpen: Accessor<boolean>;
    setBottomReplyOpen: (open: boolean) => void;
    // Sender emails (lowercased) with a CATEGORY_PERSONAL message in the thread
    personalSenders: Accessor<Set<string>>;
  };
  mobileReplyComposer: {
    open: Accessor<boolean>;
    messageId: Accessor<string | undefined>;
    setOpen: (open: boolean) => void;
    openForMessage: (id: string) => void;
    close: () => void;
  };
  replyRequest: {
    messageId: Accessor<string | undefined>;
    replyType: Accessor<ReplyType | undefined>;
    set: (messageId: string, replyType: ReplyType) => void;
    clear: () => void;
  };
  thread: Accessor<EmailThread | undefined>;
  permissions: Accessor<{
    isOwner: boolean;
  }>;

  query: {
    hasMore: Accessor<boolean>;
    isFetching: Accessor<boolean>;
    fetchNextPage: () => void | Promise<void>;
    refetch: () => void | Promise<void>;
  };

  archiveThread: (opts?: ArchiveThreadOptions) => boolean;
  /** True when the thread is archived, i.e. currently marked done. */
  isThreadDone: Accessor<boolean>;
  /** True when the done state can actually be reversed — see
   *  `markThreadNotDone`. */
  canMarkThreadNotDone: Accessor<boolean>;
  /** Unarchives a done thread and restores its notifications. */
  markThreadNotDone: () => boolean;
  /** True when the user marked the open thread unread. Resets to false per
   *  thread — viewing marks it read, so the toggle starts at Mark Unread. */
  isThreadMarkedUnread: Accessor<boolean>;
  /** Marks the open thread unread; the toggle then offers Mark Read. */
  markThreadUnread: () => boolean;
  /** Re-marks the thread read after a mark-unread. */
  markThreadRead: () => boolean;
  getMarkDoneNavigationTargetId: () => string | undefined;
  blockSender: () => boolean;
  markSenderSignal: () => boolean;
  markSenderNoise: () => boolean;
  initialLoadComplete: Accessor<boolean>;
  onInitialDataLoad: (callback: () => boolean) => void;
};

export function createEmailThreadState(
  deps: EmailThreadDependencies,
  host: EmailThreadHost = {}
): EmailThreadState {
  const threadSnapshot = createThreadSnapshot(deps.source);
  const selected = createMemo(() => {
    const thread = threadSnapshot();
    return thread ? selectThreadMessages(thread) : undefined;
  });
  const [isScrollingToMessage, setIsScrollingToMessage] = createSignal(false);
  const [focusedMessageId, setFocusedMessageId] = createSignal<string>();
  const [hiddenChipFocused, setHiddenChipFocused] = createSignal(false);
  const [hoveredStop, setHoveredStop] = createSignal<HoveredThreadStop>();
  const [replyingToMessageId, setReplyingToMessageId] = createSignal<string>();
  const [bottomReplyOpen, setBottomReplyOpen] = createSignal(false);
  const [mobileReplyComposerOpen, setMobileReplyComposerOpen] =
    createSignal(false);
  const [mobileReplyComposerMessageId, setMobileReplyComposerMessageId] =
    createSignal<string>();
  const [replyRequestMessageId, setReplyRequestMessageId] =
    createSignal<string>();
  const [replyRequestType, setReplyRequestType] = createSignal<ReplyType>();
  const [expandedMessageBodyIds, setExpandedMessageBodyIds] = createStore<
    Record<string, boolean>
  >({});
  const [targetMessageId, setTargetMessageId] = createSignal<string>();
  const [hasHandledTarget, setHasHandledTarget] = createSignal(false);
  createEffect(() => {
    const target = host.targetMessageId?.();
    setTargetMessageId(target);
    setHasHandledTarget(false);
  });

  // The newest version of each reply draft seen across query snapshots,
  // keyed by the replied-to message id. A cached snapshot populates this the
  // moment it's available (the composer must not wait on the network), and a
  // later fetch upgrades an entry only when its updated_at is newer — so the
  // revalidation of a stale cache wins, but an out-of-order response can't
  // downgrade a draft. Entries missing from a fetch are kept: deletes are
  // handled locally below, and dropping one would collapse an open composer.
  const serverDrafts = createMemo<
    { threadDbId: string; map: Record<string, EmailMessage> } | undefined
  >((prev) => {
    const data = selected();
    if (!data) return undefined;
    const next = data.draftMap;
    if (!prev || prev.threadDbId !== data.db_id) {
      return { threadDbId: data.db_id, map: next };
    }
    const map: Record<string, EmailMessage> = { ...next };
    for (const [messageId, prevDraft] of Object.entries(prev.map)) {
      const nextDraft = map[messageId];
      if (
        !nextDraft ||
        new Date(nextDraft.updated_at).getTime() <
          new Date(prevDraft.updated_at).getTime()
      ) {
        map[messageId] = prevDraft;
      }
    }
    return { threadDbId: data.db_id, map };
  });

  // Drafts the user discarded this session. Kept apart from the server map so
  // a fetch that still contains the deleted draft (delete propagation lag)
  // can't resurrect it.
  const [deletedDraftIds, setDeletedDraftIds] = createStore<
    Record<string, true>
  >({});

  const deleteDraftForMessage = (messageID: string) => {
    setDeletedDraftIds(messageID, true);
  };

  const getDraftForMessage = (messageID: string) => {
    if (deletedDraftIds[messageID]) return undefined;
    return serverDrafts()?.map[messageID];
  };

  // Drafts derive straight from the query, so "settled" is simply "we have a
  // thread snapshot" — cached or fresh, revalidating or not.
  const initialDraftsSettled = () => serverDrafts() !== undefined;

  const contacts = deps.recipients;

  const [augmentedRecipients, setAugmentedRecipients] = createSignal<
    EmailRecipient[]
  >([]);

  function onRecipientsChange(items: EmailRecipient[]) {
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

  const getRecipientOptions = () => {
    const optionsMap = new Map<string, EmailRecipient>();

    for (const contact of contacts()) {
      optionsMap.set(contact.data.email, contact);
    }

    const thread = selected();
    if (thread) {
      const seen = new Map<string, EmailContact>();

      const add = (c: EmailContact) => {
        const existing = seen.get(c.email);
        if (!existing || (!existing.name && c.name)) seen.set(c.email, c);
      };

      thread.messages.forEach((m) => {
        m.to.forEach(add);
        m.cc.forEach(add);
        m.bcc.forEach(add);
        if (m.from?.email)
          add({
            email: m.from.email,
            name: m.from.name ?? undefined,
          });
      });

      for (const value of seen.values()) {
        const mapped = convertContactInfoToEmailRecipient(value);
        optionsMap.set(mapped.data.email, mapped);
      }
    }

    augmentedRecipients().forEach((r) => {
      const email = r.data.email;
      if (email && !optionsMap.has(email)) optionsMap.set(email, r);
    });

    return Array.from(optionsMap.values());
  };

  const [messagesListRef, setMessagesListRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);
  const [messagesContainerRef, setMessagesContainerRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);

  /** Selecting a message clears the hidden-chip stop explicitly (no createEffect). */
  const setFocused = (messageID: string | undefined) => {
    if (messageID) {
      setHiddenChipFocused(false);
      const list = messagesListRef();
      const button = list ? hiddenMessagesControl(list) : undefined;
      if (button && document.activeElement === button) {
        button.blur();
        host.focusContainer?.();
      }
    }
    setFocusedMessageId(messageID);
  };

  const isContainerFilled = () => {
    const messageList = messagesListRef();
    const containerRef = messagesContainerRef();

    if (
      !messageList ||
      !containerRef ||
      !untrack(() => selected())?.db_id ||
      deps.source.isFetching()
    ) {
      return false;
    }

    // Older-page prefetch when the first batch does not overflow moved to
    // MessageList (`listNeedsOlderPage` + `fetchOlderMessages`).
    return true;
  };

  const onInitialDataLoad = (callback: () => boolean) => {
    createEffect(() => {
      if (hasHandledTarget()) return;
      const fetching = deps.source.isFetching();
      if (fetching) return;
      // Check if initial loading is complete
      const isInitialLoadComplete =
        (isContainerFilled() || deps.source.hasMore() === false) &&
        !deps.source.isFetching();

      if (!isInitialLoadComplete) return;

      // Skip if basic requirements not met
      if (!untrack(messagesListRef)) {
        return;
      }

      setHasHandledTarget(callback());
    });
  };

  const onExpandMessageBody = (messageID: string, expanded: boolean) => {
    setExpandedMessageBodyIds(messageID, expanded);
  };

  return {
    registerMessagesList: setMessagesListRef,
    registerMessagesContainer: setMessagesContainerRef,
    thread: createMemo(() => selected()),
    recipientOptions: createMemo(getRecipientOptions),
    onRecipientsChange,
    ...deps.commands,
    messagesContainerRef,
    messagesListRef,
    query: {
      hasMore: () => deps.source.hasMore() ?? false,
      fetchNextPage: deps.source.fetchOlder,
      isFetching: () =>
        deps.source.isLoading() || deps.source.isFetchingOlder(),
      refetch: deps.source.refresh,
    },
    drafts: {
      deleteDraftForMessage,
      getDraftForMessage,
      initialDraftsSettled,
    },
    messages: {
      focusedID: focusedMessageId,
      setFocused,
      hiddenChipFocused,
      setHiddenChipFocused,
      hovered: hoveredStop,
      setHovered: setHoveredStop,
      targetMessageID: targetMessageId,
      setTargetMessageID: setTargetMessageId,
      list: createMemo(() => selected()?.filtered ?? []),
      unfiltered: createMemo(() => selected()?.messages ?? []),
      // Google's CATEGORY_PERSONAL classification is inconsistent across
      // identical messages, so promote it per-sender across the thread
      personalSenders: createMemo(() => {
        const senders = new Set<string>();
        for (const message of selected()?.messages ?? []) {
          const email = message.from?.email?.toLowerCase();
          if (!email) continue;
          if (message.labels.some((l) => l.name === 'CATEGORY_PERSONAL')) {
            senders.add(email);
          }
        }
        return senders;
      }),
      expandedBodyIds: expandedMessageBodyIds,
      setExpandedBodyId: onExpandMessageBody,
      isBodyExpanded: (id: string) => expandedMessageBodyIds[id] ?? false,
      replyingToMessageId,
      setReplyingToMessageId,
      bottomReplyOpen,
      setBottomReplyOpen,
    },
    mobileReplyComposer: {
      open: mobileReplyComposerOpen,
      messageId: mobileReplyComposerMessageId,
      setOpen: setMobileReplyComposerOpen,
      openForMessage: (id: string) => {
        setMobileReplyComposerMessageId(id);
        setMobileReplyComposerOpen(true);
      },
      close: () => {
        setMobileReplyComposerOpen(false);
        setMobileReplyComposerMessageId(undefined);
      },
    },
    replyRequest: {
      messageId: replyRequestMessageId,
      replyType: replyRequestType,
      set: (messageId: string, replyType: ReplyType) => {
        setReplyRequestMessageId(messageId);
        setReplyRequestType(replyType);
      },
      clear: () => {
        setReplyRequestMessageId(undefined);
        setReplyRequestType(undefined);
      },
    },
    permissions: () => ({ isOwner: selected()?.access_level === 'owner' }),
    initialLoadComplete: hasHandledTarget,
    onInitialDataLoad,
    isScrollingToMessage,
    setIsScrollingToMessage,
  };
}
