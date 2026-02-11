import {
  COLLAPSED_THREAD_INDEX_CUTOFF,
  TARGET_MESSAGE_ACTIVE_TIME,
} from '@block-channel/constants';
import type { MessageWithThreadId } from '@block-channel/signal/threads';
import type {
  ThreadView,
  ThreadViewData,
} from '@block-channel/type/threadView';
import type { GetChannelResponseReactions } from '@service-comms/generated/models';
import { loadDraftMessage } from '@block-channel/utils/draftMessages';
import {
  createMessageListContextLookup,
  type MessageListContextLookup,
} from '@block-channel/utils/listContext';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { toast } from '@core/component/Toast/Toast';
import { observedSize } from '@core/directive/observedSize';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import SunIcon from '@icon/duotone/sun-horizon-duotone.svg';
import ArrowDownIcon from '@icon/regular/arrow-down.svg';
import XIcon from '@icon/regular/x.svg';
import type { Activity as ChannelActivity } from '@service-comms/generated/models/activity';
import type { Attachment } from '@service-comms/generated/models/attachment';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import type { Message } from '@service-comms/generated/models/message';
import { useUserId } from '@core/context/user';
import { debounce } from '@solid-primitives/scheduled';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createSelector,
  createSignal,
  For,
  Match,
  mapArray,
  on,
  onMount,
  type Setter,
  Show,
  Switch,
  untrack,
  useContext,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import type { ScrollToIndexOpts } from 'virtua/unstable_core';
import { MessageContainer } from '../Message/MessageContainer';
import { ReplyInputsPortaler } from '../ReplyInputsPortaler';
import type { MessageListContext } from '@block-channel/utils/listContext';
import { match } from 'ts-pattern';

false && observedSize;

type ThreadRow = {
  id: string;
  message: Message;
  children: Accessor<Message[]>;
};

type MessageListItemProps = {
  message: Message;
  index: Accessor<number>;
  listContext: MessageListContext;
  isFocused: boolean;
  isTarget: boolean;
  threadChildren?: Message[];
  threadSiblings?: Message[];
};

// The size of a message with a profile picture and a one line message
const BASE_ITEM_SIZE = 50;

const createDefaultMessageListContext = (index: Accessor<number>) =>
  createMemo<MessageListContext>(() => ({
    index: index(),
    isNewMessage: false,
    isFirstNewMessage: false,
    isParentNewMessage: false,
    threadIndex: -1,
    previousNonThreadedMessage: undefined,
    isInLastThread: false,
  }));

type MessageListContentContextValues = {
  setFocusedMessageId: Setter<string | undefined>;
  registerVirtualHandle: (handle: VirtualizerHandle) => void;
  scrollContainerRef: Accessor<HTMLElement | undefined>;
  registerScrollContainer: (el: HTMLElement) => void;
  scrollToIndex: (index: number, alignOpts?: ScrollToIndexOpts) => void;
  scrollToMessage: (
    messageID: string,
    index: number,
    focus?: boolean,
    alignOpts?: ScrollToIndexOpts
  ) => void;
  createReply: (id: string, focus?: boolean) => void;
  toggleThread: (threadID: string, value?: boolean) => void;
  closeThreadReply: (threadID: string, expanded?: boolean) => void;
  toggleReplyInputFocus: (threadID: string, value?: boolean) => void;
  getThreadsWithActiveReplies: () => string[];
  registerThreadAppendMountTarget: (threadID: string, el: HTMLElement) => void;
  getThreadState: (threadID: string) => ThreadView | undefined;
  orderedMessages: Accessor<Message[]>;
};

const MessageListContentContext =
  createContext<MessageListContentContextValues>();

export const useMessageListContext = () => {
  const context = useContext(MessageListContentContext);
  if (!context) {
    throw new Error(
      'useMessageListContext must be used within MessageListContentContext.Provider'
    );
  }
  return context;
};

export type TargetMessageInfo = { messageId: string; threadId?: string };

export type MessageListNavigation = {
  /** Navigate to previous message (up in the list) */
  navigatePrevious: () => boolean;
  /** Navigate to next message (down in the list) */
  navigateNext: () => boolean;
  /** Navigate to a specific message by ID */
  navigateToMessage: (messageId: string) => boolean;
};

export type ThreadStoreData = Record<string, MessageWithThreadId[]>;

export type MessageListProps = {
  channelId: string;
  messages: Message[];
  threads: ThreadStoreData;
  reactions: GetChannelResponseReactions;
  attachments: Attachment[];
  participants: ChannelParticipant[];
  latestActivity?: ChannelActivity;
  openedChannel?: Date;
  containerRef?: HTMLDivElement;
  targetMessage: Accessor<TargetMessageInfo | undefined>;
  focusedMessageId: Accessor<string | undefined>;
  setFocusedMessageId: Setter<string | undefined>;
  /** Callback to expose navigation methods to parent */
  onNavigationReady?: (nav: MessageListNavigation) => void;
  orderedMessages: Accessor<Message[]>;
  setOrderedMessages: Setter<Message[]>;
};

function EmptyMessageList() {
  return (
    <div class="flex flex-col items-center justify-center w-full h-full gap-1">
      <SunIcon class="w-16 h-16 text-ink-muted" />
      <p class="text-ink text-md">Beginning of something new...</p>
      <p class="text-ink-muted text-xs">
        Start a conversation, by sending a message.
      </p>
    </div>
  );
}

export function MessageList(props: MessageListProps) {
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [scrollContainerRef, setScrollContainerRef] = createSignal<
    HTMLDivElement | undefined
  >();

  const [threadViewStore, setThreadViewStore] = createStore<ThreadViewData>({});

  const topLevelMessages = createMemo(() =>
    props.messages.filter(
      (message) =>
        !message.thread_id &&
        (!message.deleted_at || (props.threads[message.id]?.length ?? 0) > 0)
    )
  );

  const topLevelIndexByMessageId = createMemo(() => {
    const list = topLevelMessages();
    const map = new Map<string, number>();
    for (let i = 0; i < list.length; i++) {
      const parent = list[i];
      map.set(parent.id, i);
      const children = props.threads[parent.id] ?? [];
      for (const child of children) {
        map.set(child.id, i);
      }
    }
    return map;
  });

  const getVirtualIndexForMessageId = (messageId: string) => {
    const list = topLevelMessages();
    const topLevelIndex = topLevelIndexByMessageId().get(messageId);
    if (topLevelIndex === undefined) return undefined;
    return list.length - 1 - topLevelIndex;
  };

  const scrollElementIntoView = (
    targetEl: HTMLElement,
    align: ScrollToIndexOpts['align'] = 'nearest'
  ) => {
    const handle = virtualHandle();
    const container = scrollContainerRef();
    if (!handle || !container) return;

    const targetBounds = targetEl.getBoundingClientRect();
    const containerBounds = container.getBoundingClientRect();
    const currentOffset = handle.scrollOffset;
    const targetTop = targetBounds.top - containerBounds.top + currentOffset;
    const targetBottom = targetTop + targetBounds.height;
    const visibleTop = currentOffset;
    const visibleBottom = currentOffset + handle.viewportSize;

    const nextOffset = match(align)
      .with('start', () => targetTop)
      .with('end', () => targetBottom - handle.viewportSize)
      .with(
        'center',
        () => targetTop - (handle.viewportSize - targetBounds.height) / 2
      )
      .otherwise(() => {
        if (targetTop < visibleTop) {
          return targetTop;
        } else if (targetBottom > visibleBottom) {
          return targetBottom - handle.viewportSize;
        }
        return undefined;
      });

    if (nextOffset !== undefined) {
      handle.scrollTo(nextOffset);
    }
  };

  const tryAlignMessageElement = (
    messageId: string,
    align: ScrollToIndexOpts['align'],
    focus: boolean
  ) => {
    const container = scrollContainerRef();
    if (!container) return false;
    const targetEl = container.querySelector<HTMLElement>(
      `[data-message-body-id="${messageId}"]`
    );
    if (!targetEl) return false;
    scrollElementIntoView(targetEl, align);
    if (focus) targetEl.focus();
    return true;
  };

  const scheduleAlignMessageElement = (
    messageId: string,
    align: ScrollToIndexOpts['align'] = 'nearest',
    focus: boolean = false
  ) => {
    requestAnimationFrame(() => {
      if (tryAlignMessageElement(messageId, align, focus)) return;
      setTimeout(() => {
        tryAlignMessageElement(messageId, align, focus);
      }, 0);
    });
  };

  const context: MessageListContentContextValues = {
    setFocusedMessageId: props.setFocusedMessageId,
    registerVirtualHandle: setVirtualHandle,
    scrollContainerRef,
    registerScrollContainer: setScrollContainerRef,
    scrollToIndex: function (index: number, opts?: ScrollToIndexOpts): void {
      const messageId = props.orderedMessages()[index]?.id;
      if (!messageId) return;
      const virtualIndex = getVirtualIndexForMessageId(messageId);
      if (virtualIndex === undefined) return;
      virtualHandle()?.scrollToIndex(virtualIndex, opts);
      scheduleAlignMessageElement(messageId, opts?.align, false);
    },
    scrollToMessage: function (
      messageID: string,
      _index: number,
      focus: boolean = true,
      alignOpts?: ScrollToIndexOpts
    ): void {
      const virtualIndex = getVirtualIndexForMessageId(messageID);
      if (virtualIndex === undefined) return;
      virtualHandle()?.scrollToIndex(virtualIndex, {
        align: alignOpts?.align ?? 'nearest',
      });
      scheduleAlignMessageElement(messageID, alignOpts?.align, focus);
    },
    createReply: function (id: string, focus = false): void {
      setThreadViewStore(id, (prev) => {
        return {
          ...prev,
          threadExpanded: true,
          hasActiveReply: true,
          replyInputShouldFocus: focus,
        };
      });
    },
    toggleThread: function (threadID: string, value?: boolean): void {
      setThreadViewStore(threadID, (prev) => {
        return {
          ...prev,
          threadExpanded: value ?? (prev ? !prev.threadExpanded : true),
        };
      });
    },
    closeThreadReply: function (threadID: string, expanded?: boolean): void {
      setThreadViewStore(threadID, (prev) => {
        return {
          ...prev,
          threadExpanded: expanded,
          hasActiveReply: false,
        };
      });
    },
    toggleReplyInputFocus: function (threadID: string, value?: boolean): void {
      setThreadViewStore(threadID, (prev) => {
        return {
          ...prev,
          replyInputShouldFocus:
            value ?? (prev ? !prev.replyInputShouldFocus : true),
        };
      });
    },
    getThreadsWithActiveReplies: () => {
      return Object.keys(threadViewStore).filter(
        (threadId) => threadViewStore[threadId].hasActiveReply
      );
    },
    registerThreadAppendMountTarget: function (
      threadID: string,
      el: HTMLElement
    ): void {
      setThreadViewStore(threadID, (prev) => ({
        ...prev,
        replyInputMountTarget: el,
      }));
    },
    getThreadState: function (threadID: string): ThreadView | undefined {
      return threadViewStore[threadID];
    },
    orderedMessages: props.orderedMessages,
  };
  return (
    <MessageListContentContext.Provider value={context}>
      <MessageListImpl {...props} />
    </MessageListContentContext.Provider>
  );
}

function MessageListImpl(props: MessageListProps) {
  const listContext = useMessageListContext();

  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();

  const [hasUserScrolled, setHasUserScrolled] = createSignal(false);
  const [messageListContext, setMessageListContext] =
    createStore<MessageListContextLookup>({});

  const userId = useUserId();
  const [viewThreads, setViewThreads] = createStore<ThreadStoreData>({});

  const [threadInputAttachmentsStore, setThreadInputAttachmentsStore] =
    createStore<Record<string, InputAttachment[]>>({});

  const [isNearBottom, setIsNearBottom] = createSignal(true);
  const [initialScrollComplete, setInitialScrollComplete] = createSignal(false);
  const [isScrolledBackSignificantly, setIsScrolledBackSignificantly] =
    createSignal(false);
  const [isScrollingDown, setIsScrollingDown] = createSignal(false);
  let prevScrollOffset: number | undefined;
  let downwardScrollAccumulator = 0;

  // Navigation methods for keyboard navigation
  const navigateToMessage = (messageId: string): boolean => {
    const messages = props.orderedMessages();
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return false;
    listContext.scrollToMessage(messageId, index, false, {
      align: 'nearest',
    });

    // Focus after scroll completes
    requestAnimationFrame(() => {
      const targetEl = containerRef()?.querySelector<HTMLElement>(
        `[data-message-body-id="${messageId}"]`
      );
      targetEl?.focus();
    });

    return true;
  };

  const navigateByOffset = (
    direction: -1 | 1,
    fallbackToLast: boolean
  ): boolean => {
    const messages = props.orderedMessages();
    const currentId = props.focusedMessageId();
    const currentIndex = currentId
      ? messages.findIndex((m) => m.id === currentId)
      : -1;

    if (currentIndex === -1) {
      if (fallbackToLast && messages.length > 0) {
        return navigateToMessage(messages[messages.length - 1].id);
      }
      return false;
    }

    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= messages.length) return false;

    return navigateToMessage(messages[nextIndex].id);
  };

  const navigatePrevious = (): boolean => navigateByOffset(-1, true);
  const navigateNext = (): boolean => navigateByOffset(1, false);

  // Expose navigation methods to parent
  onMount(() => {
    props.onNavigationReady?.({
      navigatePrevious,
      navigateNext,
      navigateToMessage,
    });
  });

  // Snapshot the lastViewed time so it reflects the pre-session value.
  // Without this, the activity mutation on channel open would update
  // lastViewed reactively, causing the "New" indicator to disappear.
  const lastViewed = createMemo<string | null | undefined>((prev) => {
    if (prev !== undefined) return prev;
    return props?.latestActivity?.viewed_at;
  });

  const [newMessagesDismissed, setNewMessagesDismissed] = createSignal(false);

  const checkIfNewMessage = (message: Message) => {
    if (newMessagesDismissed()) return false;
    const lastViewed_ = lastViewed();
    const openedChannel_ = props.openedChannel;
    return (
      !!lastViewed_ &&
      !!openedChannel_ &&
      new Date(message.created_at) > new Date(lastViewed_) &&
      userId() !== message.sender_id &&
      new Date(message.created_at) < openedChannel_
    );
  };

  const dismissNewMessages = () => {
    setNewMessagesDismissed(true);
    computeListContext(flattenedThreaded());
  };

  // Keep some additional timing information for goToLocationFromParams
  // race conditions.
  const [lastTargetMessageTimestamp, setLastTargetMessageTimestamp] =
    createSignal<number>(Date.now());

  // Track missing target message retries
  let missingTargetRetryCount = 0;
  let lastMissingTargetId: string | undefined;

  // represents active highlighted state on the target message
  const [targetMessageActive, setTargetMessageActive] =
    createSignal<boolean>(false);

  const activeTargetMessageId = createMemo(() => {
    if (!targetMessageActive()) return;
    return untrack(props.targetMessage)?.messageId;
  });

  const isActiveTargetMessage = createSelector(activeTargetMessageId);

  /**
   * Scroll to the bottom of the document or the target message depending on the
   * current state.
   * @param params.forceBottom - force the scroll to bottom ignoring target message
   * @returns
   */
  const scrollToBottomOrTarget = (params: { forceBottom?: boolean } = {}) => {
    const { forceBottom } = params;
    const timeStamp = Date.now();
    const delta = timeStamp - lastTargetMessageTimestamp();
    const target = props.targetMessage();

    if (
      forceBottom ||
      ((!target || delta > TARGET_MESSAGE_ACTIVE_TIME) && isNearBottom())
    ) {
      virtualHandle()?.scrollTo(0);
      return;
    }

    const { messageId: targetMessageId, threadId } = target || {};

    if (!targetMessageId) return;

    // If we have a target message, scroll to it and focus it
    const index = props
      .orderedMessages()
      ?.findIndex((m) => m.id === targetMessageId);

    if (index === -1) {
      // Retry briefly to allow hydration to complete before showing an error. Necessary for push notifications.
      if (lastMissingTargetId !== targetMessageId) {
        lastMissingTargetId = targetMessageId;
        missingTargetRetryCount = 0;
      }

      const retries = missingTargetRetryCount;
      if (retries < 6) {
        missingTargetRetryCount = retries + 1;
        setLastTargetMessageTimestamp(Date.now());
        setTimeout(() => {
          scrollToBottomOrTarget();
        }, 200);
        return;
      }

      console.warn('Target message not found');
      toast.failure('Message not found.');
      scrollToBottomOrTarget({ forceBottom: true });
      return;
    }

    // Reset retry state on success.
    if (lastMissingTargetId === targetMessageId) {
      missingTargetRetryCount = 0;
    }

    if (threadId) {
      listContext.toggleThread(threadId, true);
    }

    setTargetMessageActive(true);
    listContext.scrollToMessage(targetMessageId, index, false, {
      align: 'center',
    });
    setTimeout(() => {
      setTargetMessageActive(false);
    }, TARGET_MESSAGE_ACTIVE_TIME);
  };

  const debouncedScrollToBottomOrTarget = debounce(scrollToBottomOrTarget, 5);

  /**
   * Track context for messages as they are rendered in the list
   */
  function computeListContext(messages: Message[]) {
    const context = createMessageListContextLookup({
      messages,
      isNewMessageFn: checkIfNewMessage,
    });

    setMessageListContext(reconcile(context));
  }

  const isFocused = createSelector(props.focusedMessageId);

  // Keep the message if:
  // 1. It's not deleted, OR
  // 2. It's deleted but is a parent message
  const messageFilterFn = (message: Message) =>
    !message.deleted_at || viewThreads[message.id]?.length > 0;

  const filteredTopLevelMessages = createMemo(() =>
    props.messages.filter(messageFilterFn)
  );

  // Construct a list with thread children placed after their parent message using mapArray for referential stability.
  // mapFn is not tracking, so wrap thread-dependent logic in a memo per parent.
  const segments = mapArray(filteredTopLevelMessages, (message) =>
    createMemo(() => {
      const children = viewThreads[message.id] ?? [];
      const filteredChildren = children.filter(messageFilterFn);
      return filteredChildren.length
        ? [message, ...filteredChildren]
        : [message];
    })
  );

  const flattenedThreaded = createMemo(() => {
    const segs = segments();
    const out: Message[] = [];
    for (let i = 0; i < segs.length; i++) out.push(...segs[i]());
    return out;
  });

  const [isPrepend, setIsPrepend] = createSignal(false);

  createEffect(
    on(
      () => props.messages,
      () => {
        props.messages;
        setIsPrepend(true);
      },
      { defer: true }
    )
  );

  createEffect(
    on(flattenedThreaded, (flat, prev) => {
      const oldFlat = prev;
      if (oldFlat !== flat) {
        props.setOrderedMessages(flat);
        computeListContext(flat);
      }
    })
  );

  // Thread reply inputs are portaled to the correct message container. This keeps them in the correct location even as new thread replies come in, but if they are re-portaled while a user is typing, the user can momentarily lose input. To address this, we gate updates to the thread that a user is currently typing in.
  const [localTypingThreadId, setLocalTypingThreadId] = createSignal<
    string | undefined
  >();

  let dirtyTypingThreadId: string | undefined;

  // Maintain a local snapshot of threads that freezes changes for threads in which a user is actively typing.
  createEffect(() => {
    const baseMessages = props.messages;
    const activeThreadId = untrack(localTypingThreadId);

    for (const message of baseMessages) {
      const id = message.id;
      const threadArr = props.threads[id] ?? [];
      const currentView = viewThreads[id];
      const isTypingThisThread = id === activeThreadId;

      if (isTypingThisThread) {
        if (currentView !== threadArr) {
          dirtyTypingThreadId = id;
        }
        continue;
      }

      if (currentView !== threadArr) {
        setViewThreads(id, reconcile(threadArr));
      }

      if (dirtyTypingThreadId === id) {
        dirtyTypingThreadId = undefined;
      }
    }
  });

  // When active typing thread changes flush any pending changes for the previous typing thread.
  createEffect((prevTypingId: string | undefined) => {
    const currentTypingId = localTypingThreadId();

    if (
      prevTypingId &&
      prevTypingId !== currentTypingId &&
      dirtyTypingThreadId === prevTypingId
    ) {
      const threadArr = untrack(() => props.threads[prevTypingId] ?? []);
      setViewThreads(prevTypingId, reconcile(threadArr));
      dirtyTypingThreadId = undefined;
    }

    return currentTypingId;
  });

  const threadRows = mapArray(
    () => filteredTopLevelMessages().toReversed(),
    (message) => {
      const children = () =>
        (viewThreads[message.id] ?? []).filter(messageFilterFn);
      return { id: message.id, message, children };
    }
  );

  createEffect(() => {
    threadRows();
    setIsPrepend(false);
  });

  // Ensure thread view store store reflects drafts. Only sets when no entry exists to avoid overriding user actions.
  createEffect(() => {
    const base = filteredTopLevelMessages();
    for (const message of base) {
      const hasDraft = !!loadDraftMessage(message.channel_id, message.id);
      const threadDetails = listContext.getThreadState(message.id);
      if (hasDraft && threadDetails) {
        listContext.createReply(message.id);
      }
    }
  });

  // Indices of top-level rows that should remain mounted even when off screen.
  // Criteria: thread has an active reply, so keep its parent row mounted.
  // NOTE: VList receives reversed top-level rows, so indices must be normalized.
  const keepMountedIndices = createMemo(() => {
    const list = filteredTopLevelMessages();
    const length = list.length;
    const indices: number[] = [];
    for (let i = 0; i < length; i++) {
      const msg = list[i];
      const threadState = listContext.getThreadState(msg.id);
      if (threadState?.hasActiveReply) {
        indices.push(length - 1 - i);
      }
    }
    return indices;
  });

  const checkIfNearBottom = () => {
    const handle = virtualHandle();
    if (!handle) return false;
    if (!initialScrollComplete()) return true;

    const THRESHOLD = 100;
    const distanceFromBottom = handle.scrollOffset;
    return distanceFromBottom <= THRESHOLD;
  };

  const checkIfScrolledBackSignificantly = () => {
    const handle = virtualHandle();
    if (!handle) return false;
    const THRESHOLD = 2000;
    return handle.scrollOffset > THRESHOLD;
  };

  // Track scroll direction.
  // Requires 100px of cumulative downward scrolling before triggering.
  // Any upward scroll resets the accumulator immediately.
  const updateScrollDirection = () => {
    const handle = virtualHandle();
    if (handle && prevScrollOffset !== undefined) {
      const currentOffset = handle.scrollOffset;
      const delta = prevScrollOffset - currentOffset; // positive = scrolling down
      if (delta > 0) {
        downwardScrollAccumulator += delta;
        if (downwardScrollAccumulator >= 100) {
          setIsScrollingDown(true);
        }
      } else if (delta < 0) {
        downwardScrollAccumulator = 0;
        setIsScrollingDown(false);
      }
    }
    if (handle) {
      prevScrollOffset = handle.scrollOffset;
    }
  };

  const lastMessageReaction = createMemo(() => {
    const list = props.orderedMessages();
    const lastMessageId = list[list.length - 1]?.id;
    return props.reactions[lastMessageId];
  });

  const lastMessageThread = createMemo(() => {
    const base = filteredTopLevelMessages();
    const lastTopLevelId = base[base.length - 1]?.id;
    return viewThreads[lastTopLevelId];
  });

  const lastMessageThreadCount = createMemo(
    () => lastMessageThread()?.length ?? 0
  );

  // scroll to bottom on change to last message state (including new messages)
  createEffect(
    on(
      [lastMessageReaction, lastMessageThread, lastMessageThreadCount],
      () => {
        if (!isNearBottom()) return;
        debouncedScrollToBottomOrTarget({ forceBottom: true });
      },
      { defer: true }
    )
  );

  const [unviewedMessages, setUnviewedMessages] = createSignal<Message[]>();
  const [dismissUnviewedMessages, setDismissUnviewedMessages] =
    createSignal(false);
  const [dismissJumpToLatest, setDismissJumpToLatest] = createSignal(false);

  // Record new unviewed messages
  // TODO: show new reply state for threads with new messages
  createEffect(
    on(filteredTopLevelMessages, (newFilteredMessages, oldFilteredMessages) => {
      const handle = virtualHandle();
      if (!handle) return;
      const lastIndexInView = handle.findItemIndex(
        handle.scrollOffset + handle.viewportSize
      );
      const lastItemOffset = handle.getItemOffset(
        (oldFilteredMessages?.length ?? 0) - 1
      );
      const viewportSize = handle.viewportSize;
      if (!isNearBottom() && lastItemOffset > viewportSize) {
        const prevUnviewedMessages = unviewedMessages();
        const messages = newFilteredMessages ?? [];
        const newUnviewedMessages = messages
          .slice(lastIndexInView + 1)
          .filter(
            (msg) =>
              msg.sender_id !== userId() &&
              !oldFilteredMessages?.some((m) => m.id === msg.id) &&
              !prevUnviewedMessages?.some((m) => m.id === msg.id)
          );

        if (newUnviewedMessages.length > 0) {
          setUnviewedMessages((prev) => [
            ...(prev ?? []),
            ...newUnviewedMessages,
          ]);
          setDismissUnviewedMessages(false);
        }
      }
    })
  );

  // TODO: do we want this?
  // Scroll to the bottom on new typing updates
  // createEffect(
  //   on(usersTypingSignal.get, (typing) => {
  //     if (isNearBottom()) {
  //       virtualHandle()?.scrollToIndex(props.orderedMessages()?.length - 1, {
  //         align: 'end',
  //       });
  //     }
  //   })
  // );

  const [size, setSize] = createSignal<DOMRect>();

  createRenderEffect(
    on(props.targetMessage, (target) => {
      if (!target) return;
      setLastTargetMessageTimestamp(Date.now());
      debouncedScrollToBottomOrTarget();
    })
  );

  // Handle vlistscroll events
  const handleScroll = () => {
    if (!initialScrollComplete()) return;

    const nearBottom = checkIfNearBottom();
    setIsNearBottom(nearBottom);

    setIsScrolledBackSignificantly(checkIfScrolledBackSignificantly());
    updateScrollDirection();

    if (!nearBottom && dismissJumpToLatest()) {
      setDismissJumpToLatest(false);
    }

    const messages = unviewedMessages();
    if (messages?.length) {
      const firstUnviewed = messages[0];
      const firstUnviewedIndex = props
        .orderedMessages()
        ?.findIndex((m) => m.id === firstUnviewed.id);

      if (
        firstUnviewedIndex !== undefined &&
        firstUnviewedIndex >= 0 &&
        (virtualHandle()?.findItemIndex(
          (virtualHandle()?.scrollOffset ?? 0) +
            (virtualHandle()?.viewportSize ?? 0)
        ) ?? 0) >= firstUnviewedIndex
      ) {
        setUnviewedMessages(undefined);
      }
    }
  };

  // Jump to the first unviewed message
  const jumpToUnviewedMessages = () => {
    const messages = unviewedMessages();
    if (messages?.length) {
      const firstUnviewedIndex = props
        .orderedMessages()
        ?.findIndex((m) => m.id === messages[0].id);
      if (firstUnviewedIndex === undefined) return;
      const targetMessageId = props.orderedMessages()?.[firstUnviewedIndex]?.id;
      if (!targetMessageId) return;
      listContext.scrollToMessage(targetMessageId, firstUnviewedIndex, false, {
        align: 'start',
      });
    }
  };

  const showJumpToUnviewedMessages = createMemo(
    () => !dismissUnviewedMessages() && !!unviewedMessages()?.length
  );

  const markUserScrolled = () => {
    if (!hasUserScrolled()) {
      setHasUserScrolled(true);
    }
  };

  const listHeight = createMemo(() => size()?.height ?? 0);

  const MessageListItem = (params: MessageListItemProps) => (
    <MessageContainer
      message={params.message}
      lastViewed={lastViewed}
      isFocused={params.isFocused}
      index={params.index}
      orderedMessages={props.orderedMessages}
      threadChildren={params.threadChildren}
      threadSiblings={params.threadSiblings}
      virtualHandle={virtualHandle()!}
      container={containerRef()}
      listContext={params.listContext}
      isTarget={params.isTarget}
      channelId={() => props.channelId}
      attachments={props.attachments}
      reactions={props.reactions}
      onDismissNewMessages={dismissNewMessages}
    />
  );

  const ThreadRowItem = (rowProps: { row: ThreadRow }) => {
    const row = () => rowProps.row;
    const threadChildren = () => row().children();
    const threadState = createMemo(() =>
      listContext.getThreadState(row().message.id)
    );
    const isThreadExpanded = () => threadState()?.threadExpanded === true;
    const parentIndex = () => messageListContext[row().id]?.index ?? 0;
    const parentDefaultContext = createDefaultMessageListContext(parentIndex);
    const parentContext = () =>
      messageListContext[row().id] ?? parentDefaultContext();

    const renderThreadChild = (child: Message) => {
      const childId = () => child.id;
      const childContext = () => messageListContext[childId()];
      const childIndexAccessor = () => childContext()?.index ?? 0;
      const childDefaultContext =
        createDefaultMessageListContext(childIndexAccessor);
      const resolvedChildContext = () =>
        childContext() ?? childDefaultContext();
      const isThreadIndexWithinCutoff = createMemo(() => {
        const ctx = childContext();
        if (!ctx) return false;
        return (
          ctx.threadIndex !== -1 &&
          ctx.threadIndex <= COLLAPSED_THREAD_INDEX_CUTOFF
        );
      });

      return (
        <Show when={isThreadExpanded() || isThreadIndexWithinCutoff()}>
          <MessageListItem
            message={child}
            isFocused={isFocused(childId())}
            index={childIndexAccessor}
            threadSiblings={threadChildren()}
            listContext={resolvedChildContext()}
            isTarget={isActiveTargetMessage(child.id)}
          />
        </Show>
      );
    };

    return (
      <Show when={virtualHandle()}>
        <div>
          <MessageListItem
            message={row().message}
            isFocused={isFocused(row().id)}
            index={parentIndex}
            threadChildren={threadChildren()}
            listContext={parentContext()}
            isTarget={isActiveTargetMessage(row().message.id)}
          />
          <For each={threadChildren()}>{renderThreadChild}</For>
        </div>
      </Show>
    );
  };

  return (
    <div
      class="flex-1 overflow-y-hidden suppress-css-brackets"
      ref={(el) => setContainerRef(el)}
    >
      <div
        class="flex flex-col h-full relative"
        ref={(el) => {
          onMount(() => {
            const scrollContainer = el.querySelector(
              '[data-channel-message-list]'
            ) as HTMLDivElement | null;

            if (!scrollContainer) return;

            listContext.registerScrollContainer(scrollContainer);
          });
        }}
        onWheel={markUserScrolled}
        onTouchMove={markUserScrolled}
        onPointerDown={markUserScrolled}
        use:observedSize={{
          setSize,
        }}
      >
        <Switch fallback={<EmptyMessageList />}>
          <Match when={props.messages.length > 0}>
            <VList
              ref={(handle) => {
                if (handle) {
                  listContext.registerVirtualHandle(handle);
                }
                setVirtualHandle(handle);
              }}
              style={{
                'max-height': `${listHeight()}px`,
                height: '100%',
                contain: 'none',
                'overflow-x': 'hidden',
                'overflow-y': 'scroll',
                'overflow-anchor': 'none',
                display: 'flex',
                'flex-direction': 'column-reverse',
              }}
              class="scrollbar-hidden [&>div]:mb-auto"
              data-channel-message-list
              data={threadRows()}
              shift={isPrepend()}
              itemSize={BASE_ITEM_SIZE}
              bufferSize={10 * BASE_ITEM_SIZE}
              keepMounted={keepMountedIndices()}
              onScroll={handleScroll}
              onScrollEnd={() => {
                if (!initialScrollComplete()) {
                  setInitialScrollComplete(true);
                }
              }}
            >
              {(row: ThreadRow) => <ThreadRowItem row={row} />}
            </VList>
          </Match>
        </Switch>
        <Show when={showJumpToUnviewedMessages() && unviewedMessages()}>
          {(messages) => (
            <DeprecatedTextButton
              icon={ArrowDownIcon}
              theme="base"
              onMouseDown={jumpToUnviewedMessages}
              text={`${messages().length} new message${messages().length === 1 ? '' : 's'}`}
              secondaryIcon={XIcon}
              onOptionClick={() => setDismissUnviewedMessages(true)}
              showSeparator
              class="absolute top-4 left-1/2 -translate-x-1/2"
            />
          )}
        </Show>
        <Show
          when={
            initialScrollComplete() &&
            !dismissJumpToLatest() &&
            !showJumpToUnviewedMessages() &&
            isScrolledBackSignificantly() &&
            isScrollingDown()
          }
        >
          <DeprecatedTextButton
            icon={ArrowDownIcon}
            theme="base"
            text="Jump to latest"
            onMouseDown={() =>
              debouncedScrollToBottomOrTarget({ forceBottom: true })
            }
            secondaryIcon={XIcon}
            onOptionClick={() => setDismissJumpToLatest(true)}
            showSeparator
            class="absolute top-4 left-1/2 -translate-x-1/2 transition-opacity duration-200"
          />
        </Show>
        <CustomScrollbar
          reverse
          scrollContainer={listContext.scrollContainerRef}
          enabled={hasUserScrolled()}
        />
      </div>
      <ReplyInputsPortaler
        channelId={props.channelId}
        threads={viewThreads}
        threadInputAttachmentsStore={threadInputAttachmentsStore}
        setThreadInputAttachmentsStore={setThreadInputAttachmentsStore}
        setLocalTypingThreadId={setLocalTypingThreadId}
        participants={props.participants}
      />
    </div>
  );
}
