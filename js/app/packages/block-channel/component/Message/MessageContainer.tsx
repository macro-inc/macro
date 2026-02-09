import { useMessageListContext } from '@block-channel/component/MessageList/MessageList';
import { COLLAPSED_THREAD_INDEX_CUTOFF } from '@block-channel/constants';
import { useReactToMessage } from '@block-channel/hooks/reactions';
import type {
  Attachment,
  GetChannelResponseReactions,
} from '@service-comms/generated/models';
import type { MessageListContext } from '@block-channel/utils/listContext';
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
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import { tryMacroId, useDisplayName } from '@core/user';
import { isEmojiOnly } from '@core/util/string';
import { formatRelativeDate, isSameDay } from '@core/util/time';
import { ContextMenu } from '@kobalte/core/context-menu';
import { usePatchMessageMutation } from '@queries/channel/message';
import type { Message as MessageType } from '@service-comms/generated/models/message';
import { useUserId } from '@core/context/user';
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
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';

type MessageFlagProps = {
  text: string;
  highlight?: boolean;
};

export function MessageFlag(props: MessageFlagProps) {
  return (
    <div class="flex flex-row items-stretch justify-start ml-[var(--left-of-connector)]">
      <div class="flex flex-col items-center justify-center">
        <div class="border-l border-edge-muted min-h-1/2 ]" />
        <div
          class={`border-l ${props.highlight ? 'border-accent' : 'border-edge-muted'} min-h-1/2 `}
        />
      </div>
      <div class="flex flex-col items-center justify-center">
        <div
          class={`w-8 border-b ${props.highlight ? 'border-accent' : 'border-edge-muted'}`}
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
  isFocused: boolean;
  index: Accessor<number>;
  orderedMessages: Accessor<MessageType[]>;
  threadChildren?: MessageType[];
  threadSiblings?: MessageType[];
  newIndicatorShown: Accessor<number | undefined>;
  setNewIndicatorShown: Setter<number | undefined>;
  virtualHandle: VirtualizerHandle;
  container?: HTMLDivElement;
  listContext: MessageListContext;
  setMessageContainerRef?: Setter<HTMLDivElement | undefined>;
  isTarget: boolean;
  channelId: Accessor<string>;
  attachments: Attachment[];
  reactions: GetChannelResponseReactions;
};

export function MessageContainer(props: MessageProps) {
  const { message } = props;

  const listContext = useMessageListContext();

  const [editing, setEditing] = createSignal(false);
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [reactionSearchOpen, setReactionSearchOpen] = createSignal(false);
  const [topBarEmojiMenuOpen, setTopBarEmojiMenuOpen] = createSignal(false);
  const [messageBodyRef, setMessageBodyRef] = createSignal<HTMLDivElement>();

  const editMessageMutation = usePatchMessageMutation();

  const editMessage = (content: string) => {
    if (content.trim().length === 0) return;
    editMessageMutation.mutate({
      channelID: message.channel_id,
      messageID: message.id,
      content,
    });
  };

  const userId = useUserId();
  const [currentUserName] = useDisplayName(tryMacroId(userId() ?? ''));

  const [displayName] = useDisplayName(tryMacroId(message.sender_id));

  let messageContainerRef!: HTMLDivElement;

  // Scroll message to have editing input visible
  createEffect(() => {
    const handle = props.virtualHandle;
    if (editing() && handle) {
      requestAnimationFrame(() => {
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
  const isNewMessage = () => props.listContext.isNewMessage;

  // Works for one-level of nesting. In the future we'll need to track at which depths a message is part of a new message chain.
  const isParentNewMessage = () => props.listContext.isParentNewMessage;

  const previousMessage = () => {
    return props.index() > 0
      ? props.orderedMessages()[props.index() - 1]
      : undefined;
  };

  const newDayPreviousNonThreadMessage = () => {
    const prev = props.listContext.previousNonThreadedMessage;
    if (!prev) return false;
    return !isSameDay(new Date(message.created_at), new Date(prev.created_at));
  };

  // We consider a message consecutive if it's from the same user and the same day and has the same thread id.
  const isConsecutive = () => {
    const prevMessage_ = previousMessage();
    if (!prevMessage_) return false;
    const prevSenderId = prevMessage_?.sender_id;
    return (
      (prevMessage_.thread_id ?? '') === (message.thread_id ?? '') &&
      prevSenderId === message.sender_id &&
      isSameDay(new Date(prevMessage_.created_at), new Date(message.created_at))
    );
  };

  const threadState = createMemo(() => {
    const threadID = message.thread_id;
    if (!threadID) return;

    return listContext.getThreadState(threadID);
  });

  const messageState = createMemo(() => {
    return listContext.getThreadState(message.id);
  });

  const isFirstMessage = createMemo(() => {
    return props.index() === 0;
  });

  // A message can be the last message if it's 1. the last message or 2. in the last thread at the collapsed thread index cutoff and the thread is not expanded
  const isLastMessage = createMemo(() => {
    return (
      props.index() === props.orderedMessages().length - 1 ||
      (props.listContext.isInLastThread &&
        !threadState()?.threadExpanded &&
        props.listContext.threadIndex === COLLAPSED_THREAD_INDEX_CUTOFF)
    );
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
      !threadState()?.threadExpanded &&
      props.threadSiblings &&
      props.threadSiblings.length > COLLAPSED_THREAD_INDEX_CUTOFF + 1 &&
      props.listContext.threadIndex === COLLAPSED_THREAD_INDEX_CUTOFF
    );
  });

  const shouldShowThreadAppendInput = createMemo(() => {
    return threadState()?.hasActiveReply === true;
  });

  const shouldShowFirstReply = createMemo(() => {
    return !props.threadChildren?.length && messageState()?.hasActiveReply;
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
    props.attachments.filter((a) => a.message_id === message.id)
  );
  const imageAttachments = createMemo(() =>
    attachments().filter((a: Attachment) => a.entity_type === STATIC_IMAGE)
  );
  const videoAttachments = createMemo(() =>
    attachments().filter((a: Attachment) => a.entity_type === STATIC_VIDEO)
  );
  const documentAttachments = createMemo(() =>
    attachments().filter(
      (a: Attachment) => !isStaticAttachmentType(a.entity_type)
    )
  );

  const reactToMessage = useReactToMessage(
    props.channelId,
    () => props.reactions
  );

  const react = (emoji: string) => reactToMessage(emoji, message.id);

  const onThreadAppend = () => {
    const threadId = message.thread_id;
    if (!threadId) return;
    listContext.createReply(threadId, true);
    listContext.scrollToIndex(props.index(), {
      align: 'nearest',
    });
  };

  const onCreateReply = () => {
    listContext.createReply(message.id, true);
    listContext.scrollToIndex(props.index(), {
      align: 'nearest',
    });
  };

  const actions = createMessageActions({
    channelId: message.channel_id,
    messageId: message.id,
    messageContent: message.content ?? '',
    threadId: message.thread_id ?? undefined,
    senderId: message.sender_id,
    onEdit: () => setEditing(true),
    onReply: onCreateReply,
  });

  const [attachFn, scopeId] = useHotkeyDOMScope('channel.messageContainer');

  onMount(() => {
    attachFn(messageContainerRef);
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
      listContext.createReply(message.id);
      listContext.scrollToIndex(focusedIndex);
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
      ? !messageState()?.threadExpanded
      : !threadState()?.threadExpanded;
  });

  const setThreadExpansion = (shouldExpand: boolean) => {
    const threadId = hasThreadChildren() ? message.id : message.thread_id;
    if (!threadId) return;

    listContext.toggleThread(threadId, shouldExpand);
  };

  registerHotkey({
    hotkey: 'arrowright',
    scopeId: scopeId,
    description: 'Expand thread',
    condition: () => expandThreadCondition(),
    hotkeyToken: TOKENS.channel.expandThread,
    keyDownHandler: () => {
      setThreadExpansion(true);
      listContext.scrollToMessage(message.id, props.index());
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
        listContext.scrollToMessage(parentId, parentIndex);
      }
      return true;
    },
    hotkeyToken: TOKENS.channel.collapseThread,
    displayPriority: 10,
  });

  const isEmptyMessage = createMemo(() => {
    return message.content.trim() === '';
  });

  const isEmojiOnlyMessage = createMemo(() => {
    return isEmojiOnly(message.content ?? '');
  });

  const handleThreadToggle = () => {
    if (!message.thread_id) return;
    const threadState_ = threadState();

    if (!threadState_) {
      listContext.toggleThread(message.thread_id, true);
      return;
    }

    listContext.toggleThread(message.thread_id);
  };

  const { isKeypressActive } = useIsKeyPressActive();

  const setSelectedMessage = () => {
    listContext.setFocusedMessageId(message.id);
  };

  const setSelectedMessageFromMouse = () => {
    if (isKeypressActive()) return;
    listContext.setFocusedMessageId(message.id);
  };

  return (
    <div
      class={`shrink-0 flex justify-center w-full ${isTouchDevice() ? 'no-select-children' : ''}`}
      ref={(el) => {
        props.setMessageContainerRef?.(el);
        messageContainerRef = el;
      }}
      onFocusIn={() => {
        setSelectedMessage();
      }}
      onMouseMove={() => {
        if (isTouchDevice()) return;
        setSelectedMessageFromMouse();
      }}
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
                newDayPreviousNonThreadMessage()))
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

        <ContextMenu
          onOpenChange={(isOpen) => {
            setContextMenuOpen(isOpen);
          }}
        >
          <ContextMenu.Trigger disabled={editing()}>
            <MessageComponent
              id={message.id}
              focused={props.isFocused}
              senderId={message.sender_id}
              isFirstMessage={isFirstMessage()}
              isLastMessage={isLastMessage()}
              isConsecutive={isConsecutive()}
              timestamp={message.created_at}
              shouldHover={contextMenuOpen() || topBarEmojiMenuOpen()}
              hoverActions={
                <ActionMenu
                  messageId={message.id}
                  channelId={props.channelId}
                  reactions={() => props.reactions}
                  actions={actions()}
                  setReactionMenuActivated={setTopBarEmojiMenuOpen}
                />
              }
              threadDepth={threadDepth()}
              hasThreadChildren={hasThreadChildren() || shouldShowFirstReply()}
              isFirstInThread={isFirstInThread()}
              isLastInThread={isLastInThread()}
              isDeleted={!!message.deleted_at}
              isNewMessage={isNewMessage()}
              isParentNewMessage={isParentNewMessage()}
              onThreadAppend={onThreadAppend}
              shouldShowThreadAppendInput={shouldShowThreadAppendInput()}
              isTarget={props.isTarget}
              setThreadAppendMountTarget={(el) => {
                if (!message.thread_id) return;

                listContext.registerThreadAppendMountTarget(
                  message.thread_id,
                  el
                );
              }}
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
                    save={editMessage}
                  />
                }
              >
                <MessageComponent.Body isDeleted={!!message.deleted_at}>
                  <Show when={!isEmptyMessage()}>
                    <div classList={{ 'text-3xl': isEmojiOnlyMessage() }}>
                      <StaticMarkdown
                        markdown={message.content ?? ''}
                        theme={channelTheme}
                        target="internal"
                      />
                    </div>
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
                <MessageReactions
                  messageId={props.message?.id ?? ''}
                  channelId={props.channelId}
                  reactions={() => props.reactions}
                />
              </Show>
            </MessageComponent>
            <Show when={isLastInCollapsedThread()}>
              <div
                class="border-l border-edge-muted pb-1"
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
                    isThreadOpen={threadState()?.threadExpanded}
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
                    fullWidth={isMobile()}
                    insideMenu={true}
                  />
                </Match>
              </Switch>
              <Show when={isMobile()}>
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
                <div class={`${MENU_CONTENT_CLASS} mt-4`}>
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
            shouldShowThreadAppendInput
            setThreadAppendMountTarget={(el) =>
              listContext.registerThreadAppendMountTarget(message.id, el)
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
