import { COLLAPSED_THREAD_INDEX_CUTOFF } from '@block-channel/constants';
import { messageAttachmentsStore } from '@block-channel/signal/attachment';
import { editMessage } from '@block-channel/signal/channel';
import { reactToMessage } from '@block-channel/signal/reactions';
import type { ThreadViewData } from '@block-channel/type/threadView';
import type { MessageListContext } from '@block-channel/utils/listContext';
import { scrollIntoViewAndFocus } from '@block-channel/utils/scrollAndFocus';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import {
  ContextMenuContent,
  MENU_CONTENT_CLASS,
  MenuItem,
  MenuSeparator,
} from '@core/component/Menu';
import { Message as MessageComponent } from '@core/component/Message';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import {
  type InputAttachment,
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import { useDisplayName } from '@core/user';
import { formatRelativeDate, isSameDay } from '@core/util/time';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { Message as MessageType } from '@service-comms/generated/models/message';
import { useUserId } from '@service-gql/client';
import { createCallback } from '@solid-primitives/rootless';
import { activeElement } from 'app/signal/focus';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onMount,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import type { VirtualizerHandle } from 'virtua/solid';
import { TypingIndicator } from '../MessageList/TypingIndicator';
import {
  EmojiSearchSelector,
  ReactionQuickSelector,
} from '../ReactionSelector';
import { ActionMenu } from './ActionMenu';
import { createMessageActions } from './actions';
import { EditMessageInput } from './EditMessageInput';
import { MessageAttachments } from './MessageAttachments';
import { MessageReactions } from './MessageReactions';
import { ThreadReplyIndicator } from './ThreadReplyIndicator';

type MessageFlagProps = {
  text: string;
  highlight?: boolean;
};

export function MessageFlag(props: MessageFlagProps) {
  return (
    <div class="flex flex-row items-stretch justify-start ml-[var(--left-of-connector)]">
      <div class="flex flex-col items-center justify-center">
        <div class="border-l border-edge min-h-1/2 ]" />
        <div
          class={`border-l ${props.highlight ? 'border-accent' : 'border-edge'} min-h-1/2 `}
        />
      </div>
      <div class="flex flex-col items-center justify-center">
        <div
          class={`w-8 border-b ${props.highlight ? 'border-accent' : 'border-edge'}`}
        />
      </div>
      <div
        class={`text-xs text-panel uppercase font-mono p-1 my-3 ${props.highlight ? 'bg-accent' : 'bg-edge'}`}
      >
        {props.text}
      </div>
    </div>
  );
}

type NewIndicatorProps = {
  setNewIndicatorShown: Setter<number | undefined>;
  id: number;
};

function NewMessageIndicator(props: NewIndicatorProps) {
  onMount(() => {
    props.setNewIndicatorShown(props.id);
  });

  return <MessageFlag text="New" highlight />;
}

type MessageProps = {
  message: MessageType;
  lastViewed: Accessor<string | null | undefined>;
  newMessageIndex: Accessor<number | undefined>;
  isFocused: boolean;
  setFocusedMessageId: Setter<string | undefined>;
  index: Accessor<number>;
  orderedMessages: Accessor<MessageType[]>;
  threadChildren?: MessageType[];
  threadSiblings?: MessageType[];
  threadViewStore: ThreadViewData;
  setThreadViewStore: SetStoreFunction<ThreadViewData>;
  threadInputAttachmentsStore: Record<string, InputAttachment[]>;
  setThreadInputAttachmentsStore: SetStoreFunction<
    Record<string, InputAttachment[]>
  >;
  newIndicatorShown: Accessor<number | undefined>;
  setNewIndicatorShown: Setter<number | undefined>;
  virtualHandle: VirtualizerHandle;
  container?: HTMLDivElement;
  listContext: MessageListContext;
  targetMessageId: string | undefined;
};

export function MessageContainer(props: MessageProps) {
  const { message } = props;
  const [editing, setEditing] = createSignal(false);
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [reactionSearchOpen, setReactionSearchOpen] = createSignal(false);
  const [topBarEmojiMenuOpen, setTopBarEmojiMenuOpen] = createSignal(false);
  const [messageBodyRef, setMessageBodyRef] = createSignal<HTMLDivElement>();
  const editMessage_ = createCallback(editMessage);

  const userId = useUserId();
  const [currentUserName] = useDisplayName(userId());

  const attachmentStore = messageAttachmentsStore.get;

  const [displayName] = useDisplayName(message.sender_id);

  let messageContainerRef: HTMLDivElement | undefined;

  // Scroll message to have editing input visible
  createEffect(() => {
    if (editing() && props.virtualHandle) {
      const handle = props.virtualHandle!;

      requestAnimationFrame(() => {
        if (!messageContainerRef) return;

        const messageBounds = messageContainerRef.getBoundingClientRect();
        const containerBounds = props.container?.getBoundingClientRect();
        if (!containerBounds) return;

        const messageTop =
          messageBounds.top - containerBounds.top + handle.scrollOffset;
        const messageBottom = messageTop + messageBounds.height;

        const visibleTop = handle.scrollOffset;
        const visibleBottom = handle.scrollOffset + handle.viewportSize;

        if (messageBottom > visibleBottom) {
          handle.scrollTo(messageBottom - handle.viewportSize + 20);
        } else if (messageTop < visibleTop) {
          handle.scrollTo(messageTop - 20);
        }
      });
    }
  });

  // We're only checking new messages that are not part of a thread
  const isNewMessage = () => props.listContext?.isNewMessage ?? false;

  // Works for one-level of nesting. In the future we'll need to track at which depths a message is part of a new message chain.
  const isParentNewMessage = () =>
    props.listContext?.isParentNewMessage ?? false;

  const previousMessage = createMemo(() => {
    return props.index() > 0
      ? props.orderedMessages()[props.index() - 1]
      : undefined;
  });

  const previousNonThreadMessage = () =>
    props.listContext?.previousNonThreadedMessage;

  // We consider a message consecutive if it's from the same user and the same day and has the same thread id.
  const isConsecutive = createMemo(() => {
    const prevMessage_ = previousMessage();
    if (!prevMessage_) return false;
    const prevSenderId = prevMessage_?.sender_id;
    return (
      (prevMessage_.thread_id ?? '') === (message.thread_id ?? '') &&
      prevSenderId === message.sender_id &&
      isSameDay(new Date(prevMessage_.created_at), new Date(message.created_at))
    );
  });

  const isFirstMessage = createMemo(() => {
    return props.index() === 0;
  });

  const isLastMessage = createMemo(() => {
    return props.index() === props.orderedMessages().length - 1;
  });

  // currently arbitrarily limiting thread depth to 1, in the future we may want to support deeper threads
  const threadDepth = createMemo(() => {
    return message.thread_id ? 1 : 0;
  });

  const hasThreadChildren = createMemo(() => {
    return props.threadChildren && props.threadChildren.length > 0;
  });

  const isFirstInThread = createMemo(() => {
    return (
      !!message.thread_id && previousMessage()?.thread_id !== message.thread_id
    );
  });

  const isLastInThread = createMemo(() => {
    return (
      !!message.thread_id && props.threadSiblings?.at(-1)?.id === message.id
    );
  });

  const isLastInCollapsedThread = createMemo(() => {
    return (
      !props.threadViewStore[message.thread_id ?? '']?.threadExpanded &&
      props.threadSiblings &&
      props.threadSiblings.length > COLLAPSED_THREAD_INDEX_CUTOFF + 1 &&
      props.listContext.threadIndex === COLLAPSED_THREAD_INDEX_CUTOFF
    );
  });

  const shouldShowThreadAppendInput = createMemo(() => {
    return props.threadViewStore[message.thread_id ?? '']?.hasActiveReply;
  });

  const shouldShowFirstReply = createMemo(() => {
    return (
      !props.threadChildren &&
      props.threadViewStore[message.id ?? '']?.hasActiveReply
    );
  });

  const collapsedThreadMessages = createMemo(() => {
    if (isLastInCollapsedThread()) {
      return props.threadSiblings?.slice(COLLAPSED_THREAD_INDEX_CUTOFF + 1);
    }
    return [];
  });
  const lastReplyTimestamp = createMemo(() => {
    if (collapsedThreadMessages()) {
      return collapsedThreadMessages()?.at(-1)?.created_at ?? '';
    }
    return '';
  });
  const threadReplyUsers = createMemo(() => {
    if (collapsedThreadMessages()) {
      const messages = collapsedThreadMessages() ?? [];
      const seenUserIds = new Set<string>();
      const uniqueUserIds: string[] = [];
      for (const message of messages) {
        const userId = message.sender_id;
        if (userId && !seenUserIds.has(userId)) {
          seenUserIds.add(userId);
          uniqueUserIds.push(userId);
        }
      }
      return uniqueUserIds;
    }
    return [];
  });

  const attachments = createMemo(() =>
    message.id ? (attachmentStore[message.id] ?? []) : []
  );
  const imageAttachments = createMemo(() =>
    attachments().filter((a) => a.entity_type === STATIC_IMAGE)
  );
  const videoAttachments = createMemo(() =>
    attachments().filter((a) => a.entity_type === STATIC_VIDEO)
  );
  const documentAttachments = createMemo(() =>
    attachments().filter((a) => !isStaticAttachmentType(a.entity_type))
  );

  const react = createCallback((emoji: string) =>
    reactToMessage(emoji, message.id)
  );

  const onThreadAppend = () => {
    const threadId = message.thread_id;
    if (!threadId) return;
    props.setThreadViewStore(threadId, (prev) => {
      return {
        ...prev,
        hasActiveReply: true,
        threadExpanded: true,
        replyInputShouldFocus: true,
      };
    });
    props.virtualHandle.scrollToIndex(props.index(), {
      align: 'nearest',
    });
  };

  const onCreateReply = () => {
    props.setThreadViewStore(message.id ?? '', () => {
      return {
        threadExpanded: true,
        hasActiveReply: true,
        replyInputShouldFocus: true,
      };
    });
    props.virtualHandle.scrollToIndex(props.index());
  };

  const actions = createMessageActions({
    messageId: message.id,
    messageContent: message.content ?? '',
    threadId: message.thread_id ?? undefined,
    senderId: message.sender_id,
    onEdit: () => setEditing(true),
    onReply: onCreateReply,
  });

  const [attachFn, scopeId] = useHotkeyDOMScope('channel.messageContainer');

  onMount(() => {
    if (messageContainerRef) {
      attachFn(messageContainerRef);
    }
  });

  registerHotkey({
    hotkey: 'e',
    scopeId: scopeId,
    description: 'Edit message',
    condition: () => {
      return (
        props.isFocused &&
        userId() === message.sender_id &&
        !editing() &&
        (messageBodyRef()?.contains(activeElement()) ?? false)
      );
    },
    keyDownHandler: () => {
      setEditing(true);
      return true;
    },
    hotkeyToken: TOKENS.channel.editMessage,
    displayPriority: 10,
  });

  registerHotkey({
    hotkey: ['enter'],
    scopeId: scopeId,
    description: 'Reply to message',
    condition: () => {
      return props.isFocused && !message.thread_id;
    },
    keyDownHandler: () => {
      const focusedIndex = props
        .orderedMessages()
        .findIndex((m) => m.id === message.id);
      if (focusedIndex === -1) return false;
      props.setThreadViewStore(message.id ?? '', () => {
        return { threadExpanded: true, hasActiveReply: true };
      });
      props.virtualHandle?.scrollToIndex(focusedIndex);
      return true;
    },
    hotkeyToken: TOKENS.channel.replyToMessage,
    displayPriority: 10,
  });

  const expandThreadCondition = createMemo(() => {
    const hasThreadParent = !!message.thread_id;
    if (!hasThreadParent && !hasThreadChildren()) return false;

    if (hasThreadParent) {
      // Don't allow expansion toggle if thread has less than COLLAPSED_THREAD_INDEX_CUTOFF + 1 messages
      if (
        props.threadSiblings &&
        props.threadSiblings.length < COLLAPSED_THREAD_INDEX_CUTOFF + 1
      )
        return false;
    } else if (hasThreadChildren()) {
      const childCount = props.threadChildren?.length || 0;
      if (childCount < COLLAPSED_THREAD_INDEX_CUTOFF + 1) return false;
    }

    return hasThreadChildren()
      ? !props.threadViewStore[message.id ?? '']?.threadExpanded
      : !props.threadViewStore[message.thread_id ?? '']?.threadExpanded;
  });

  const setThreadExpansion = (shouldExpand: boolean) => {
    const threadId = hasThreadChildren() ? message.id : message.thread_id;
    if (!threadId) return;
    props.setThreadViewStore(threadId, (prev) =>
      prev
        ? { ...prev, threadExpanded: shouldExpand }
        : { threadExpanded: shouldExpand }
    );
  };

  registerHotkey({
    hotkey: 'arrowright',
    scopeId: scopeId,
    description: 'Expand thread',
    condition: () => expandThreadCondition(),
    hotkeyToken: TOKENS.channel.expandThread,
    keyDownHandler: () => {
      setThreadExpansion(true);
      scrollIntoViewAndFocus({
        virtualHandle: props.virtualHandle,
        container: props.container,
        targetIndex: props.index(),
        targetId: message.id,
      });
      return true;
    },
    displayPriority: 10,
  });

  registerHotkey({
    hotkey: 'arrowleft',
    scopeId: scopeId,
    description: 'Go to thread parent',
    condition: () => !!message.thread_id,
    keyDownHandler: () => {
      setThreadExpansion(false);
      const parentId = message.thread_id;
      if (!parentId) return true;

      // Ensure the parent message is in view before focusing
      const parentIndex = props
        .orderedMessages()
        .findIndex((m) => m.id === parentId);
      if (parentIndex >= 0) {
        scrollIntoViewAndFocus({
          virtualHandle: props.virtualHandle,
          container: props.container,
          targetIndex: parentIndex,
          targetId: parentId,
        });
      }
      return true;
    },
    hotkeyToken: TOKENS.channel.collapseThread,
    displayPriority: 10,
  });

  const isEmptyMessage = createMemo(() => {
    return message.content.trim() === '';
  });

  const handleThreadToggle = () => {
    if (!message.thread_id) return;
    if (!props.threadViewStore[message.thread_id]) {
      props.setThreadViewStore(message.thread_id, () => ({
        threadExpanded: true,
      }));

      scrollIntoViewAndFocus({
        virtualHandle: props.virtualHandle,
        container: props.container,
        targetIndex: props.index() + 1,
        targetId:
          props.threadSiblings?.at(COLLAPSED_THREAD_INDEX_CUTOFF + 1)?.id ?? '',
      });
    } else {
      props.setThreadViewStore(message.thread_id, (prev) => ({
        ...prev,
        threadExpanded: !prev.threadExpanded,
      }));
      if (props.threadViewStore[message.thread_id]?.threadExpanded) {
        scrollIntoViewAndFocus({
          virtualHandle: props.virtualHandle,
          container: props.container,
          targetIndex: props.index() + 1,
          targetId: message.thread_id,
        });
      } else {
        scrollIntoViewAndFocus({
          virtualHandle: props.virtualHandle,
          container: props.container,
          targetIndex: props
            .orderedMessages()
            .findIndex((m) => m.id === message.thread_id),
          targetId: message.thread_id,
        });
      }
    }
  };

  return (
    <div
      class={`shrink-0 flex justify-center w-full ${isTouchDevice ? 'no-select-children' : ''}
      [--thread-shift:23px] @sm:[--thread-shift:46px] [--user-icon-width:30px] @sm:[--user-icon-width:40px] [--left-of-connector:20px] @sm:[--left-of-connector:28px] [--left-of-user-icon:calc(var(--left-of-connector)-var(--user-icon-width)/2)]`}
      ref={messageContainerRef}
      data-message-id={message.id}
    >
      <div class="macro-message-width w-full">
        {/* Date separator */}
        <Show
          when={
            !message.thread_id &&
            (props.index() === 0 ||
              (props.index() > 0 &&
                !message.thread_id &&
                previousNonThreadMessage() &&
                !isSameDay(
                  new Date(message.created_at),
                  new Date(previousNonThreadMessage()!.created_at)
                )))
          }
        >
          <MessageFlag text={formatRelativeDate(message.created_at)} />
        </Show>
        {/* New message indicator */}
        <Show
          when={
            isNewMessage() &&
            (!props.newIndicatorShown() ||
              props.newIndicatorShown() === props.index())
          }
        >
          <NewMessageIndicator
            id={props.index()}
            setNewIndicatorShown={props.setNewIndicatorShown}
          />
        </Show>
        {/* Message item */}
        <Show
          when={!message.content.startsWith('%%MEETING_NOTIFICATION%%')}
          fallback={
            <div class="bg-accent-light p-2 rounded-md w-full flex justify-center items-center">
              <p class="text-xs text-ink-muted">
                {(() => {
                  const content =
                    message.content?.replace('%%MEETING_NOTIFICATION%%', '') ||
                    '';
                  const senderId = message.sender_id;
                  const currentUserId = userId();
                  // Handle contextual messages
                  if (content.startsWith('Call not answered')) {
                    // Extract timestamp if present
                    const match = content.match(/at (.+)$/);
                    const timestamp = match ? match[1] : '';
                    // If the current user is the sender, they initiated the call
                    // If not, they missed the call
                    return senderId === currentUserId
                      ? content
                      : timestamp
                        ? `Missed call at ${timestamp}`
                        : 'Missed call';
                  }
                  // For all other messages, just return as is
                  return content;
                })()}
              </p>
            </div>
          }
        >
          <ContextMenu
            onOpenChange={(isOpen) => {
              setContextMenuOpen(isOpen);
            }}
          >
            <ContextMenu.Trigger>
              <MessageComponent
                id={message.id}
                focused={props.isFocused}
                senderId={message.sender_id}
                isFirstMessage={isFirstMessage()}
                isLastMessage={isLastMessage()}
                isConsecutive={isConsecutive()}
                shouldHover={contextMenuOpen() || topBarEmojiMenuOpen()}
                hoverActions={
                  <ActionMenu
                    messageId={message.id}
                    actions={actions()}
                    setReactionMenuActivated={setTopBarEmojiMenuOpen}
                  />
                }
                threadDepth={threadDepth()}
                hasThreadChildren={
                  hasThreadChildren() || shouldShowFirstReply()
                }
                isFirstInThread={isFirstInThread()}
                isLastInThread={isLastInThread()}
                isDeleted={!!message.deleted_at}
                isNewMessage={isNewMessage()}
                isParentNewMessage={isParentNewMessage()}
                onThreadAppend={onThreadAppend}
                shouldShowThreadAppendInput={shouldShowThreadAppendInput}
                isTarget={props.targetMessageId === message.id}
                setThreadAppendMountTarget={(el) =>
                  props.setThreadViewStore(message.thread_id ?? '', (prev) => ({
                    ...prev,
                    replyInputMountTarget: el,
                  }))
                }
                setMessageBodyRef={setMessageBodyRef}
              >
                <MessageComponent.TopBar
                  name={displayName()}
                  timestamp={message.created_at}
                />
                <Show
                  when={!editing()}
                  fallback={
                    <EditMessageInput
                      content={props.message?.content ?? ''}
                      setEditing={setEditing}
                      save={(input) =>
                        editMessage_(props.message?.id ?? '', input)
                      }
                    />
                  }
                >
                  <MessageComponent.Body isDeleted={!!message.deleted_at}>
                    <Show when={!isEmptyMessage()}>
                      <StaticMarkdown
                        markdown={message.content ?? ''}
                        theme={channelTheme}
                        target="internal"
                      />
                    </Show>
                  </MessageComponent.Body>
                </Show>
                <MessageAttachments
                  videoAttachments={videoAttachments}
                  imageAttachments={imageAttachments}
                  documentAttachments={documentAttachments}
                  isDeleted={() => !!message.deleted_at}
                  isCurrentUser={() => userId() === message.sender_id}
                  channelId={message.channel_id}
                  messageId={message.id}
                  content={message.content}
                />
                <Show when={!message.deleted_at}>
                  <MessageReactions messageId={props.message?.id ?? ''} />
                </Show>
              </MessageComponent>
              <Show when={isLastInCollapsedThread()}>
                <div
                  class="border-l border-edge pb-1"
                  style={{
                    'margin-left': `var(--left-of-connector)`,
                  }}
                >
                  <div
                    class="relative"
                    style={{
                      'margin-left': `calc(var(--thread-shift) * ${threadDepth()} - 1px - var(--user-icon-width) / 2)`,
                    }}
                  >
                    <ThreadReplyIndicator
                      countCollapsedMessages={
                        collapsedThreadMessages()?.length || 0
                      }
                      timestamp={lastReplyTimestamp()}
                      users={threadReplyUsers()}
                      onClick={handleThreadToggle}
                      isThreadOpen={
                        props.threadViewStore[message.thread_id!]
                          ?.threadExpanded
                      }
                    />
                  </div>
                </div>
              </Show>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenuContent
                onCloseAutoFocus={() => {
                  setReactionSearchOpen(false);
                }}
                mobileFullScreen
                overrideStyling
              >
                <Switch>
                  <Match when={!reactionSearchOpen()}>
                    <ReactionQuickSelector
                      onEmojiClick={(emoji) => react(emoji.emoji)}
                      handleClose={() => {
                        setReactionSearchOpen(false);
                      }}
                      setSearchOpen={setReactionSearchOpen}
                      insideMenu
                      showFocusRing={true}
                    />
                  </Match>
                  <Match when={reactionSearchOpen()}>
                    <EmojiSearchSelector
                      onEmojiClick={(emoji) => react(emoji.emoji)}
                      handleClose={() => {
                        setReactionSearchOpen(false);
                      }}
                      fullWidth={isTouchDevice && isMobileWidth()}
                      insideMenu={true}
                    />
                  </Match>
                </Switch>
                <Show when={isTouchDevice && isMobileWidth()}>
                  <ContextMenu.Item class="mt-4 shrink-1 overflow-y-scroll overflow-x-hidden">
                    <MessageComponent
                      focused={props.isFocused}
                      senderId={message.sender_id}
                      isFirstMessage={isFirstMessage()}
                      isLastMessage={isLastMessage()}
                      hideConnectors
                    >
                      <MessageComponent.TopBar
                        name={displayName()}
                        timestamp={message.created_at}
                      />
                      <MessageComponent.Body>
                        <StaticMarkdown
                          markdown={message.content ?? ''}
                          theme={channelTheme}
                          target="internal"
                        />
                      </MessageComponent.Body>
                      <MessageAttachments
                        videoAttachments={videoAttachments}
                        imageAttachments={imageAttachments}
                        documentAttachments={documentAttachments}
                        isDeleted={() => !!message.deleted_at}
                        isCurrentUser={() => userId() === message.sender_id}
                        channelId={message.channel_id}
                        messageId={message.id}
                        content={message.content}
                      />
                    </MessageComponent>
                  </ContextMenu.Item>
                </Show>
                <Show when={!reactionSearchOpen()}>
                  <div class={MENU_CONTENT_CLASS + ' mt-4'}>
                    <For each={actions().filter((a) => a.enabled)}>
                      {(a) => (
                        <>
                          <Show when={a.dividerBefore}>
                            <MenuSeparator />
                          </Show>
                          <MenuItem
                            onClick={a.onClick}
                            text={a.text}
                            icon={a.icon}
                          />
                        </>
                      )}
                    </For>
                  </div>
                </Show>
              </ContextMenuContent>
            </ContextMenu.Portal>
          </ContextMenu>
        </Show>
        <Show when={shouldShowFirstReply()}>
          <MessageComponent
            focused={false}
            unfocusable
            senderId={userId()}
            isFirstMessage={false}
            isLastMessage={false}
            threadDepth={threadDepth() + 1}
            isFirstInThread
            isLastInThread
            shouldShowThreadAppendInput={createSignal(true)[0]}
            setThreadAppendMountTarget={(el) =>
              props.setThreadViewStore(message.id ?? '', (prev) => ({
                ...prev,
                replyInputMountTarget: el,
              }))
            }
          >
            <MessageComponent.TopBar name={currentUserName()} />
            <div class="h-4" />
          </MessageComponent>
        </Show>
        <Show when={isLastMessage()}>
          <TypingIndicator
            // threadId={message.thread_id ?? undefined}
            previousMessage={message}
          />
        </Show>
      </div>
    </div>
  );
}
