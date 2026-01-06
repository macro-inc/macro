import {
  COLLAPSED_THREAD_INDEX_CUTOFF,
  TARGET_MESSAGE_ACTIVE_TIME,
} from '@block-channel/constants';
import { openedChannelSignal } from '@block-channel/signal/activity';
import { messageToReactionStore } from '@block-channel/signal/reactions';
import {
  type ThreadStoreData,
  threadsStore,
} from '@block-channel/signal/threads';
import type {
  ThreadView,
  ThreadViewData,
} from '@block-channel/type/threadView';
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
import { clamp } from '@core/util/math';
import SunIcon from '@icon/duotone/sun-horizon-duotone.svg';
import ArrowDownIcon from '@icon/regular/arrow-down.svg';
import XIcon from '@icon/regular/x.svg';
import type { Activity as ChannelActivity } from '@service-comms/generated/models/activity';
import type { Message } from '@service-comms/generated/models/message';
import { useUserId } from '@service-gql/client';
import { debounce } from '@solid-primitives/scheduled';
import { activeElement } from 'app/signal/focus';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createSelector,
  createSignal,
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

false && observedSize;

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const toScrollHintDate = (isoDate?: string) => {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const formatter =
    date.getFullYear() === now.getFullYear()
      ? SHORT_DATE_FORMATTER
      : LONG_DATE_FORMATTER;
  return formatter.format(date).toUpperCase();
};

// Provide stable row models to VList so item instances are preserved across moves/insertions
type RowModel = {
  id: string;
  message: Message;
};

// The size of a message with a profile picture and a one line message
const BASE_ITEM_SIZE = 50;

type MessageListContentContextValues = {
  registerVirtualHandle: (handle: VirtualizerHandle) => void;
  scrollContainerRef: Accessor<HTMLElement | undefined>;
  registerScrollContainer: (el: HTMLElement) => void;
  scrollToIndex: (index: number, alignOpts?: ScrollToIndexOpts) => void;
  scrollToMessage: (messageID: string, index: number, focus?: boolean) => void;
  createReply: (id: string, focus?: boolean) => void;
  toggleThread: (threadID: string, value?: boolean) => void;
  clearThreadFocus: (threadID: string, expanded?: boolean) => void;
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

  return context!;
};

export type TargetMessageInfo = { messageId: string; threadId?: string };

export type MessageListProps = {
  channelId: string;
  messages: Message[];
  latestActivity?: ChannelActivity;
  containerRef?: HTMLDivElement;
  targetMessage: Accessor<TargetMessageInfo | undefined>;
  focusedMessageId: Accessor<string | undefined>;
  setFocusedMessageId: Setter<string | undefined>;
  orderedMessages: Accessor<Message[]>;
  setOrderedMessages: Setter<Message[]>;
  setLastMessageRef?: Setter<HTMLDivElement | undefined>;
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

  const normalizeIndex = (index: number) => {
    const length = props.orderedMessages().length;

    return length - 1 - index;
  };

  const context: MessageListContentContextValues = {
    registerVirtualHandle: setVirtualHandle,
    scrollContainerRef,
    registerScrollContainer: setScrollContainerRef,
    scrollToIndex: function (index: number, opts?: ScrollToIndexOpts): void {
      virtualHandle()?.scrollToIndex(normalizeIndex(index), opts);
    },
    scrollToMessage: function (
      messageID: string,
      index: number,
      focus: boolean = true
    ): void {
      const handle = virtualHandle();

      if (!handle) return;

      handle.scrollToIndex(normalizeIndex(index), { align: 'end' });
      if (!focus) return;
      const targetEl = scrollContainerRef()?.querySelector<HTMLElement>(
        `[data-message-body-id="${messageID}"]`
      );
      if (targetEl) {
        requestAnimationFrame(() => {
          targetEl.focus();
        });
      }
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
    clearThreadFocus: function (threadID: string, expanded?: boolean): void {
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

  const [newIndicatorShown, setNewIndicatorShown] = createSignal<number>();
  const [hasUserScrolled, setHasUserScrolled] = createSignal(false);
  const [messageListContext, setMessageListContext] =
    createStore<MessageListContextLookup>({});

  const userId = useUserId();
  const threads = threadsStore.get;
  const [viewThreads, setViewThreads] = createStore<ThreadStoreData>({});

  const [threadInputAttachmentsStore, setThreadInputAttachmentsStore] =
    createStore<Record<string, InputAttachment[]>>({});

  const [isNearBottom, setIsNearBottom] = createSignal(true);
  const [initialScrollComplete, setInitialScrollComplete] = createSignal(false);

  const openedChannel = openedChannelSignal.get;

  const normalizeIndex = (index: number) => {
    const length = props.orderedMessages().length;

    return length - 1 - index;
  };

  const lastViewed = createMemo(() => {
    return props?.latestActivity?.viewed_at;
  });

  const checkIfNewMessage = (message: Message) => {
    const lastViewed_ = lastViewed();
    const openedChannel_ = openedChannel();
    return (
      !!lastViewed_ &&
      !!openedChannel_ &&
      new Date(message.created_at) > new Date(lastViewed_) &&
      userId() !== message.sender_id &&
      new Date(message.created_at) < new Date(openedChannel_)
    );
  };

  // Keep some additional timing information for goToLocationFromParams
  // race conditions.
  const [lastTargetMessageTimestamp, setLastTargetMessageTimestamp] =
    createSignal<number>(Date.now());

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
      const lastIndex = 0;
      virtualHandle()?.scrollToIndex(lastIndex, {
        align: 'end',
      });
      return;
    }

    const { messageId: targetMessageId, threadId } = target || {};

    if (!targetMessageId) return;

    // If we have a target message, scroll to it and focus it
    const index = props
      .orderedMessages()
      ?.findIndex((m) => m.id === targetMessageId);

    if (index === -1) {
      console.warn('Target message not found');
      toast.failure('Message not found.');
      scrollToBottomOrTarget({ forceBottom: true });
      return;
    }

    if (threadId) {
      listContext.toggleThread(threadId, true);
    }

    setTargetMessageActive(true);
    virtualHandle()?.scrollToIndex(normalizeIndex(index), {
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

  createEffect(() => {
    const activeElement_ = activeElement();
    const activeMessageId = activeElement_?.getAttribute(
      'data-message-body-id'
    );

    props.setFocusedMessageId(activeMessageId ?? undefined);
  });

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

  createEffect(() => {
    props.messages;
    setIsPrepend(true);
  });

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
      const threadArr = threads[id] ?? [];
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
      const threadArr = untrack(() => threads[prevTypingId] ?? []);
      setViewThreads(prevTypingId, reconcile(threadArr));
      dirtyTypingThreadId = undefined;
    }

    return currentTypingId;
  });

  const rows = mapArray(
    () => props.orderedMessages().toReversed(),
    (msg) => {
      return { id: msg.id, message: msg } as RowModel;
    }
  );

  createEffect(() => {
    rows();
    setIsPrepend(false);
  });

  const getScrollHint = () => {
    if (!hasUserScrolled()) return;
    const handle = virtualHandle();
    const list = props.orderedMessages();
    if (!handle || !list || list.length === 0) return;

    const endIndex = handle.findItemIndex(handle.scrollOffset);

    if (endIndex === undefined) return;

    const index = clamp(endIndex, 0, list.length - 1);
    const row = rows()[index];
    const label = toScrollHintDate(row?.message.created_at);

    return label;
  };

  // Ensure thread view store store reflects drafts. Only sets when no entry exists to avoid overriding user actions.
  createEffect(() => {
    const base = filteredTopLevelMessages() ?? [];
    for (const message of base) {
      const hasDraft = !!loadDraftMessage(message.channel_id, message.id);
      const threadDetails = listContext.getThreadState(message.id);
      if (hasDraft && threadDetails) {
        listContext.createReply(message.id);
      }
    }
  });

  // Indices of messages that should remain mounted even when off screen.
  // Criteria: message is last in its thread AND that thread has an active reply.
  const keepMountedIndices = createMemo(() => {
    const list = props.orderedMessages() ?? [];
    const indices: number[] = [];
    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      const next = list[i + 1];
      const threadId = msg.thread_id;

      if (!threadId) continue;

      const threadState = listContext.getThreadState(threadId);

      // Since orderedMessages is a flat list: if the next message' thread id is different OR
      // there is no next message, then this message is the last message in the thread
      const isLastInThread =
        (next && next.thread_id !== msg.thread_id) || !next;

      // We captured this thread reply but there was no message. The user might be
      // typing or want to type a reply
      const isLocallyFrozenWithEmptyMessage = !viewThreads[msg.id]?.length;

      if (
        (isLastInThread && threadState?.hasActiveReply) ||
        (threadState?.hasActiveReply && isLocallyFrozenWithEmptyMessage)
      ) {
        indices.push(i);
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

  const lastMessageReaction = createMemo(() => {
    const messageToReaction = messageToReactionStore.get;
    const list = props.orderedMessages();
    const lastMessageId = list[list.length - 1]?.id;
    return messageToReaction[lastMessageId];
  });

  const lastMessageThread = createMemo(() => {
    const base = filteredTopLevelMessages() ?? [];
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
      virtualHandle()?.scrollToIndex(normalizeIndex(firstUnviewedIndex), {
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
              data={rows() ?? []}
              shift={isPrepend()}
              bufferSize={30 * BASE_ITEM_SIZE}
              keepMounted={keepMountedIndices()}
              onScroll={handleScroll}
              onScrollEnd={() => {
                if (!initialScrollComplete()) {
                  setInitialScrollComplete(true);
                }
              }}
            >
              {(row: { id: string; message: Message }, i) => {
                const isParentless = () => !row.message.thread_id;
                const isThreadExpanded = createMemo(() => {
                  if (!row.message.thread_id) return false;

                  const state = listContext.getThreadState(
                    row.message.thread_id
                  );

                  return state?.threadExpanded === true;
                });
                const isThreadIndexWithinCutoff = createMemo(
                  () =>
                    messageListContext[row.id].threadIndex !== -1 &&
                    messageListContext[row.id].threadIndex <=
                      COLLAPSED_THREAD_INDEX_CUTOFF
                );
                return (
                  <Show
                    when={
                      (isParentless() ||
                        isThreadExpanded() ||
                        isThreadIndexWithinCutoff()) &&
                      virtualHandle()
                    }
                  >
                    <MessageContainer
                      message={row.message}
                      lastViewed={lastViewed}
                      isFocused={isFocused(row.id)}
                      index={() => normalizeIndex(i())}
                      orderedMessages={props.orderedMessages}
                      threadSiblings={viewThreads[
                        row.message.thread_id ?? ''
                      ]?.filter(messageFilterFn)}
                      threadChildren={viewThreads[row.message.id ?? '']?.filter(
                        messageFilterFn
                      )}
                      newIndicatorShown={newIndicatorShown}
                      setNewIndicatorShown={setNewIndicatorShown}
                      virtualHandle={virtualHandle()!}
                      container={containerRef()}
                      listContext={messageListContext[row.id]}
                      setLastMessageRef={props.setLastMessageRef}
                      isTarget={isActiveTargetMessage(row.message.id)}
                    />
                  </Show>
                );
              }}
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
            !isNearBottom()
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
          getLabel={getScrollHint}
          enabled={hasUserScrolled()}
        />
      </div>
      <ReplyInputsPortaler
        channelId={props.channelId}
        threads={viewThreads}
        threadInputAttachmentsStore={threadInputAttachmentsStore}
        setThreadInputAttachmentsStore={setThreadInputAttachmentsStore}
        setLocalTypingThreadId={setLocalTypingThreadId}
      />
    </div>
  );
}
