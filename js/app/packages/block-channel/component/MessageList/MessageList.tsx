import {
  COLLAPSED_THREAD_INDEX_CUTOFF,
  TARGET_MESSAGE_ACTIVE_TIME,
} from '@block-channel/constants';
import { openedChannelSignal } from '@block-channel/signal/activity';
import { messageToReactionStore } from '@block-channel/signal/reactions';
import { threadsStore } from '@block-channel/signal/threads';
import { usersTypingSignal } from '@block-channel/signal/typing';
import type { ThreadViewData } from '@block-channel/type/threadView';
import { loadDraftMessage } from '@block-channel/utils/draftMessages';
import {
  createMessageListContextLookup,
  type MessageListContextLookup,
} from '@block-channel/utils/listContext';
import { TextButton } from '@core/component/TextButton';
import { observedSize } from '@core/directive/observedSize';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import SunIcon from '@icon/duotone/sun-horizon-duotone.svg';
import ArrowDownIcon from '@icon/regular/arrow-down.svg';
import XIcon from '@icon/regular/x.svg';
import type { Activity as ChannelActivity } from '@service-comms/generated/models/activity';
import type { Message } from '@service-comms/generated/models/message';
import { useUserId } from '@service-gql/client';
import { activeElement } from 'app/signal/focus';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  Match,
  mapArray,
  on,
  type Setter,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { MessageContainer } from '../Message/MessageContainer';
import { ReplyInputsPortaler } from '../ReplyInputsPortaler';

false && observedSize;

export type MessageListProps = {
  channelId: string;
  messages: Message[];
  latestActivity?: ChannelActivity;
  containerRef?: HTMLDivElement;
  targetMessage: Accessor<
    | {
        messageId: string;
        threadId?: string;
      }
    | undefined
  >;
  focusedMessageId: Accessor<string | undefined>;
  setFocusedMessageId: Setter<string | undefined>;
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
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [newIndicatorShown, setNewIndicatorShown] = createSignal<number>();
  const [messageListContext, setMessageListContext] =
    createStore<MessageListContextLookup>({});

  const userId = useUserId();
  const threads = threadsStore.get;

  const [threadInputAttachmentsStore, setThreadInputAttachmentsStore] =
    createStore<Record<string, InputAttachment[]>>({});

  const [threadViewStore, setThreadViewStore] = createStore<ThreadViewData>({});

  const [isNearBottom, setIsNearBottom] = createSignal(false);

  const openedChannel = openedChannelSignal.get;

  const lastViewed = createMemo(() => {
    return props?.latestActivity?.viewed_at;
  });

  const checkIfNewMessage = (message: Message) => {
    return (
      !!lastViewed() &&
      new Date(message.created_at) > new Date(lastViewed()!) &&
      userId() !== message.sender_id &&
      new Date(message.created_at) < new Date(openedChannel()!)
    );
  };

  // Keep some additional timing information for goToLocationFromParams
  // race conditions.
  const [lastTargetMessageTimestamp, setLastTargetMessageTimestamp] =
    createSignal<number>(Date.now());
  createEffect(
    on(props.targetMessage, () => {
      setLastTargetMessageTimestamp(Date.now());
    })
  );

  const [activeTargetMessage, setActiveTargetMessage] = createSignal<
    | {
        messageId: string;
        threadId?: string;
      }
    | undefined
  >();

  let targetTimeoutId: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const target = props.targetMessage();

    if (targetTimeoutId) {
      clearTimeout(targetTimeoutId);
      targetTimeoutId = undefined;
    }

    if (target) {
      setActiveTargetMessage(target);
      targetTimeoutId = setTimeout(() => {
        setActiveTargetMessage(undefined);
        targetTimeoutId = undefined;
      }, TARGET_MESSAGE_ACTIVE_TIME);
    } else {
      setActiveTargetMessage(undefined);
    }
  });

  let scrollTimeoutId: ReturnType<typeof setTimeout> | undefined;

  /**
   * Scroll to the bottom of the document or the target message depending on the
   * current state.
   * @param params.forceBottom - force the scroll to bottom even if the user is not near the bottom
   * @param params.onlyBottom - skip all targetMessage bases logic.
   * @returns
   */
  const scrollToBottomOrTarget = (params?: {
    forceBottom?: boolean;
    onlyBottom?: boolean;
  }) => {
    const { forceBottom } = params || { forceBottom: false };
    const timeStamp = Date.now();
    const delta = timeStamp - untrack(lastTargetMessageTimestamp);
    const target = props.targetMessage();

    if (
      (!target || delta > TARGET_MESSAGE_ACTIVE_TIME) &&
      (isNearBottom() || forceBottom)
    ) {
      if (scrollTimeoutId) clearTimeout(scrollTimeoutId);
      scrollTimeoutId = setTimeout(() => {
        virtualHandle()?.scrollToIndex(
          (props.orderedMessages()?.length ?? 1) - 1,
          {
            align: 'end',
          }
        );
      }, 0);
      return;
    }
    if (params?.onlyBottom) return;

    const { messageId: targetMessageId, threadId } = target || {};

    // If we have a target message, scroll to it and focus it
    if (targetMessageId) {
      const index = props
        .orderedMessages()
        ?.findIndex((m) => m.id === targetMessageId);

      if (index >= 0) {
        if (threadId) {
          setThreadViewStore(threadId, (prev) => ({
            ...prev,
            threadExpanded: true,
          }));
        }
        if (scrollTimeoutId) clearTimeout(scrollTimeoutId);
        scrollTimeoutId = setTimeout(() => {
          virtualHandle()?.scrollToIndex(index, {
            align: 'center',
          });
        }, 0);
        return;
      }
    }
  };

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
    if (activeMessageId) {
      props.setFocusedMessageId(activeMessageId);
    } else {
      props.setFocusedMessageId(undefined);
    }
  });

  const isFocused = createSelector(props.focusedMessageId);

  // Keep the message if:
  // 1. It's not deleted, OR
  // 2. It's deleted but is a parent message
  const messageFilterFn = (message: Message) => {
    return !message.deleted_at || threads[message.id]?.length > 0;
  };

  const filteredTopLevelMessages = createMemo(() =>
    props.messages.filter(messageFilterFn)
  );

  // Construct a list with thread children placed after their parent message using mapArray for referential stability.
  // mapFn is not tracking, so wrap thread-dependent logic in a memo per parent.
  const segments = mapArray(filteredTopLevelMessages, (message) =>
    createMemo(() => {
      const children = threads[message.id] ?? [];
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

  // Thread reply inputs are portaled to the correct message container. This keeps them in the right place, but if they are portaled while a user is typing, the user can lose input. To address this, we do not update the threaded messages until the user stops typing.
  const [localTyping, setLocalTyping] = createSignal(false);
  let updateDelayedByTyping = false;

  createEffect(
    on([flattenedThreaded, localTyping], ([flat, typing], prev) => {
      const oldFlat = prev?.[0];
      if (!typing && (oldFlat !== flat || updateDelayedByTyping)) {
        props.setOrderedMessages(flat);
        computeListContext(flat);
        updateDelayedByTyping = false;
      } else if (typing && oldFlat !== flat) {
        updateDelayedByTyping = true;
      }
    })
  );

  // Provide stable row models to VList so item instances are preserved across moves/insertions
  type RowModel = {
    id: string;
    message: Message;
  };

  const rows = mapArray(props.orderedMessages, (msg) => {
    return { id: msg.id, message: msg } as RowModel;
  });

  // Ensure thread view store store reflects drafts. Only sets when no entry exists to avoid overriding user actions.
  createEffect(() => {
    const base = filteredTopLevelMessages() ?? [];
    for (const message of base) {
      const hasDraft = !!loadDraftMessage(message.channel_id, message.id);
      if (hasDraft && !threadViewStore[message.id]) {
        setThreadViewStore(message.id, {
          threadExpanded: true,
          hasActiveReply: true,
        });
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
      const threadId = msg.thread_id ?? '';
      if (
        (threadId &&
          ((next && next.thread_id !== msg.thread_id) || !next) &&
          threadViewStore[threadId]?.hasActiveReply) ||
        (threadViewStore[msg.id]?.hasActiveReply && !threads[msg.id]?.length)
      ) {
        indices.push(i);
      }
    }
    return indices;
  });

  const checkIfNearBottom = () => {
    const handle = virtualHandle();
    if (!handle) return false;

    const THRESHOLD = 100;
    const distanceFromBottom =
      handle.scrollSize - handle.scrollOffset - handle.viewportSize;
    return distanceFromBottom <= THRESHOLD;
  };

  const lastMessageReaction = createMemo(() => {
    const messageToReaction = messageToReactionStore.get;
    const list = props.orderedMessages();
    const lastMessageId = list[list.length - 1]?.id;
    return messageToReaction[lastMessageId];
  });

  // Track updates to the last top-level message's thread (for scroll behavior)
  const lastMessageThread = createMemo(() => {
    const base = filteredTopLevelMessages() ?? [];
    const lastTopLevelId = base[base.length - 1]?.id;
    return threads[lastTopLevelId];
  });

  createEffect(
    on([lastMessageReaction, lastMessageThread], () => {
      if (!isNearBottom()) return;
      if (
        lastMessageReaction() ||
        (lastMessageThread() && lastMessageThread()?.length > 0)
      ) {
        scrollToBottomOrTarget();
      }
    })
  );

  const [unviewedMessages, setUnviewedMessages] = createSignal<Message[]>();
  const [dismissUnviewedMessages, setDismissUnviewedMessages] =
    createSignal(false);
  const [dismissJumpToLatest, setDismissJumpToLatest] = createSignal(false);
  const [newMessageIndex, setNewMessageIndex] = createSignal<number>();

  // Record new unviewed messages
  createEffect(
    on(filteredTopLevelMessages, (newFilteredMessages, oldFilteredMessages) => {
      const handle = virtualHandle();
      if (!handle) return;
      const lastIndexInView = handle.findEndIndex();
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

  // Record the index of the first unviewed message, to set a new new message indicator
  createEffect(
    on([unviewedMessages], () => {
      if (unviewedMessages()?.length) {
        setNewMessageIndex(
          props
            .orderedMessages()
            ?.findIndex((m) => m.id === unviewedMessages()?.[0]?.id)
        );
      }
    })
  );

  // Scroll to the bottom on new typing updates
  createEffect(
    on(usersTypingSignal.get, () => {
      if (isNearBottom()) {
        virtualHandle()?.scrollToIndex(props.orderedMessages()?.length - 1, {
          align: 'end',
        });
      }
    })
  );

  const [size, setSize] = createSignal<DOMRect>();
  const [initialized, setInitialized] = createSignal(false);

  // scroll to bottom on size change, if the user is near the bottom
  createEffect(
    on(virtualHandle, () => {
      scrollToBottomOrTarget({ forceBottom: true });
    })
  );

  // scroll to bottom (if near) or target on size change, new messages, or
  // target change.
  createEffect(
    on([size, props.orderedMessages, props.targetMessage], () => {
      scrollToBottomOrTarget();
    })
  );

  // Handle vlistscroll events
  const handleScroll = () => {
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
        (virtualHandle()?.findEndIndex() ?? 0) >= firstUnviewedIndex
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
      virtualHandle()?.scrollToIndex(firstUnviewedIndex, {
        align: 'start',
      });
    }
  };

  const showJumpToUnviewedMessages = createMemo(
    () => !dismissUnviewedMessages() && !!unviewedMessages()?.length
  );

  return (
    <div
      class="flex-1 overflow-y-hidden suppress-css-brackets"
      ref={(el) => setContainerRef(el)}
    >
      <div
        class="flex flex-col h-full relative"
        use:observedSize={{
          setSize: setSize,
          setInitialized: setInitialized,
        }}
      >
        <Switch fallback={<EmptyMessageList />}>
          <Match when={initialized() && props.messages.length > 0 && size()}>
            <VList
              ref={setVirtualHandle}
              style={{
                height: `${size()!.height}px`,
                'padding-top': '10px',
                contain: 'none',
                'overflow-x': 'hidden',
                'overflow-y': 'scroll',
              }}
              data={rows() ?? []}
              overscan={10}
              keepMounted={keepMountedIndices()}
              onScroll={handleScroll}
            >
              {(row: { id: string; message: Message }, i) => {
                const isParentless = !row.message.thread_id;
                const isThreadExpanded = createMemo(
                  () =>
                    threadViewStore[row.message.thread_id ?? '']?.threadExpanded
                );
                const isThreadIndexWithinCutoff = createMemo(
                  () =>
                    messageListContext[row.id].threadIndex !== -1 &&
                    messageListContext[row.id].threadIndex <=
                      COLLAPSED_THREAD_INDEX_CUTOFF
                );
                return (
                  <Show
                    when={
                      isParentless ||
                      isThreadExpanded() ||
                      isThreadIndexWithinCutoff()
                    }
                  >
                    <MessageContainer
                      message={row.message}
                      lastViewed={lastViewed}
                      newMessageIndex={newMessageIndex}
                      isFocused={isFocused(row.id)}
                      setFocusedMessageId={props.setFocusedMessageId}
                      index={i}
                      orderedMessages={props.orderedMessages}
                      threadSiblings={threads[
                        row.message.thread_id ?? ''
                      ]?.filter(messageFilterFn)}
                      threadChildren={threads[row.message.id ?? '']?.filter(
                        messageFilterFn
                      )}
                      threadViewStore={threadViewStore}
                      setThreadViewStore={setThreadViewStore}
                      threadInputAttachmentsStore={threadInputAttachmentsStore}
                      setThreadInputAttachmentsStore={
                        setThreadInputAttachmentsStore
                      }
                      newIndicatorShown={newIndicatorShown}
                      setNewIndicatorShown={setNewIndicatorShown}
                      virtualHandle={virtualHandle()!}
                      container={containerRef()}
                      listContext={messageListContext[row.id]}
                      targetMessageId={activeTargetMessage()?.messageId}
                    />
                  </Show>
                );
              }}
            </VList>
          </Match>
        </Switch>
        <Show when={showJumpToUnviewedMessages() && unviewedMessages()}>
          {(messages) => (
            <TextButton
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
            !dismissJumpToLatest() &&
            !showJumpToUnviewedMessages() &&
            !isNearBottom()
          }
        >
          <TextButton
            icon={ArrowDownIcon}
            theme="base"
            text="Jump to latest"
            onMouseDown={() =>
              scrollToBottomOrTarget({ forceBottom: true, onlyBottom: true })
            }
            secondaryIcon={XIcon}
            onOptionClick={() => setDismissJumpToLatest(true)}
            showSeparator
            class="absolute top-4 left-1/2 -translate-x-1/2 transition-opacity duration-200"
          />
        </Show>
      </div>
      <ReplyInputsPortaler
        channelId={props.channelId}
        orderedMessages={props.orderedMessages}
        threadViewStore={threadViewStore}
        setThreadViewStore={setThreadViewStore}
        threads={threads}
        virtualHandle={virtualHandle}
        threadInputAttachmentsStore={threadInputAttachmentsStore}
        setThreadInputAttachmentsStore={setThreadInputAttachmentsStore}
        setLocalTyping={setLocalTyping}
      />
    </div>
  );
}
