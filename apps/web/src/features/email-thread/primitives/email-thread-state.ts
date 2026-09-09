import type { Accessor } from 'solid-js';
import { createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { EmailRecipient } from '../../email-compose/core/email-recipient';
import type { ReplyType } from '../../email-compose/core/reply-type';
import type { EmailMessage } from '../../email-message/core/email-message';
import type {
  ArchiveThreadOptions,
  EmailThreadContext,
  EmailThreadHost,
} from '../context/email-thread-context';
import type { EmailThread } from '../core/email-thread';
import { selectThreadMessages } from '../core/thread-messages';
import type { HoveredThreadStop } from '../core/thread-stops';
import { hiddenMessagesControl } from './scroll-to-message';
import { createThreadDrafts } from './thread-drafts';
import { createThreadRecipients } from './thread-recipients';
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
    getDraftForMessage: (messageDbId: string) => EmailMessage | undefined;
    deleteDraftForMessage: (messageDbId: string) => void;
    initialDraftsSettled: Accessor<boolean>;
  };

  messages: {
    unfiltered: Accessor<EmailMessage[]>;
    list: Accessor<EmailMessage[]>;
    targetMessageId: Accessor<string | undefined>;
    setTargetMessageId: (id: string | undefined) => void;
    focusedId: Accessor<string | undefined>;
    setFocused: (messageId: string | undefined) => void;
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
    fetchNextPage: () => Promise<void>;
    refetch: () => Promise<void>;
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
  threadContext: EmailThreadContext,
  host: EmailThreadHost = {}
): EmailThreadState {
  const threadSnapshot = createThreadSnapshot(threadContext.source);
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
  const [replyRequest, setReplyRequest] = createSignal<{
    messageId: string;
    replyType: ReplyType;
  }>();
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

  const drafts = createThreadDrafts(selected);

  const recipients = createThreadRecipients(
    threadContext.recipients,
    () => selected()?.messages
  );

  const [messagesListRef, setMessagesListRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);
  const [messagesContainerRef, setMessagesContainerRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);

  /** Selecting a message clears the hidden-chip stop explicitly (no createEffect). */
  const setFocused = (messageId: string | undefined) => {
    if (messageId) {
      setHiddenChipFocused(false);
      const list = messagesListRef();
      const button = list ? hiddenMessagesControl(list) : undefined;
      if (button && document.activeElement === button) {
        button.blur();
        host.focusContainer?.();
      }
    }
    setFocusedMessageId(messageId);
  };

  const onInitialDataLoad = (callback: () => boolean) => {
    createEffect(() => {
      if (hasHandledTarget() || threadContext.source.isFetching()) return;
      if (!messagesListRef()) return;
      if (
        (!messagesContainerRef() || !untrack(selected)?.db_id) &&
        threadContext.source.hasMore()
      )
        return;

      setHasHandledTarget(callback());
    });
  };

  return {
    registerMessagesList: setMessagesListRef,
    registerMessagesContainer: setMessagesContainerRef,
    thread: selected,
    recipientOptions: recipients.options,
    onRecipientsChange: recipients.add,
    ...threadContext.createCommands(threadSnapshot),
    messagesContainerRef,
    messagesListRef,
    query: {
      hasMore: threadContext.source.hasMore,
      fetchNextPage: threadContext.source.fetchOlder,
      isFetching: () =>
        threadContext.source.isLoading() ||
        threadContext.source.isFetchingOlder(),
      refetch: threadContext.source.refresh,
    },
    drafts,
    messages: {
      focusedId: focusedMessageId,
      setFocused,
      hiddenChipFocused,
      setHiddenChipFocused,
      hovered: hoveredStop,
      setHovered: setHoveredStop,
      targetMessageId: targetMessageId,
      setTargetMessageId: setTargetMessageId,
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
      setExpandedBodyId: setExpandedMessageBodyIds,
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
      messageId: () => replyRequest()?.messageId,
      replyType: () => replyRequest()?.replyType,
      set: (messageId: string, replyType: ReplyType) => {
        setReplyRequest({ messageId, replyType });
      },
      clear: () => {
        setReplyRequest(undefined);
      },
    },
    permissions: () => ({ isOwner: selected()?.access_level === 'owner' }),
    initialLoadComplete: hasHandledTarget,
    onInitialDataLoad,
    isScrollingToMessage,
    setIsScrollingToMessage,
  };
}
