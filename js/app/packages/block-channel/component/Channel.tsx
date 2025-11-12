import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useNavigatedFromJK } from '@app/component/SoupContext';
import type { ChannelData } from '@block-channel/definition';
import {
  latestActivitySignal,
  updateActivityOnChannelClose,
  updateActivityOnChannelOpen,
} from '@block-channel/signal/activity';
import {
  isDraggingOverChannelSignal,
  isValidChannelDragSignal,
} from '@block-channel/signal/attachment';
import {
  channelStore,
  initializeChannelData,
  refetchChannelData,
} from '@block-channel/signal/channel';
import { activeThreadIdSignal } from '@block-channel/signal/threads';
import { handleFileUpload } from '@block-channel/utils/inputAttachments';
import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { useBlockId } from '@core/block';
import type { DragEventWithData } from '@core/component/FileList/DraggableItem';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { fileDrop } from '@core/directive/fileDrop';
import { TOKENS } from '@core/hotkey/tokens';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { createTabFocusEffect } from '@core/signal/tabFocus';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import { ChannelDebouncedNotificationReadMarker } from '@notifications/components/DebouncedNotificationReadMarker';
import type { Message } from '@service-comms/generated/models';
import { connectionGatewayClient } from '@service-connection/client';
import { createCallback } from '@solid-primitives/rootless';
import { useBeforeLeave, useSearchParams } from '@solidjs/router';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { toast } from 'core/component/Toast/Toast';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { createMethodRegistration } from 'core/orchestrator';
import { createRenderEffect, createSignal, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { type FocusableElement, tabbable } from 'tabbable';
import { ChannelInput } from './ChannelInput';
import { MessageList } from './MessageList/MessageList';
import { Top } from './Top';

false && fileDrop;

/** 10 seconds threshold */
const THRESHOLD = 10_000;

export function createChannelRefetchEffect(channelId: string) {
  let lastTime = Date.now();

  /** Refetch channel data if the tab is focused */
  createTabFocusEffect((isTabFocused) => {
    if (isTabFocused && Date.now() - lastTime > THRESHOLD) {
      console.log('tab focused, refetching channel data');
      refetchChannelData(channelId);
      connectionGatewayClient.trackEntity({
        entity_type: 'channel',
        entity_id: channelId,
        action: 'open',
      });
      lastTime = Date.now();
    }
  });
}

export function Channel(props: { data: Required<ChannelData> }) {
  const channel = channelStore.get; // this is our source of truth because data can be updated outside
  const [_activeThreadId, setActiveThreadId] = activeThreadIdSignal;
  const latestActivity = latestActivitySignal.get;
  const updateActivityOnOpen = createCallback(updateActivityOnChannelOpen);
  const updateActivityOnClose = createCallback(updateActivityOnChannelClose);
  const channelId = useBlockId();
  const { track } = withAnalytics();
  let containerRef!: HTMLDivElement;
  const [_searchParams] = useSearchParams();
  const [channelInputAttachmentsStore, setChannelInputAttachmentsStore] =
    createStore<Record<string, InputAttachment[]>>({});
  // All messages, including threads, in order of how they should be displayed, i.e. thread children are placed after their parent message
  const [orderedMessages, setOrderedMessages] = createSignal<Message[]>([]);
  const scopeId = blockHotkeyScopeSignal.get;
  const blockRef = blockElementSignal.get;
  const setIsDraggingOverChannel = isDraggingOverChannelSignal.set;
  const setIsValidChannelDrag = isValidChannelDragSignal.set;
  const notificationSource = useGlobalNotificationSource();

  const blockHandle = blockHandleSignal.get;
  const [targetMessage, setTargetMessage] = createSignal<{
    messageId: string;
    threadId?: string;
  }>();

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: Record<string, any>) => {
      if (params.thread_id) {
        setActiveThreadId(params.thread_id);
      }
      if (params.message_id) {
        setTargetMessage({
          messageId: params.message_id,
          threadId: params.thread_id,
        });
      }
    },
  });

  const [focusedMessageId, setFocusedMessageId] = createSignal<
    string | undefined
  >(undefined);

  onMount(() => {
    initializeChannelData(props.data);
    updateActivityOnOpen();

    track(TrackingEvents.BLOCKCHANNEL.CHANNEL.OPEN);
  });

  createChannelRefetchEffect(channelId);

  useBeforeLeave(() => {
    updateActivityOnClose();
  });

  const droppable = createDroppable('channel-input-' + channelId);

  false && droppable;

  const [, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];

  function handleAttach(attachment: InputAttachment) {
    const list = channelInputAttachmentsStore[channelId] ?? [];
    if (list.find((a) => a.id === attachment.id))
      return toast.failure('Attachment already attached');
    if (list.length >= 10)
      return toast.failure('You can only attach up to 10 files at a time');
    setChannelInputAttachmentsStore(channelId, (prev = []) => [
      ...prev,
      attachment,
    ]);
  }

  onDragEnd((event: DragEventWithData) => {
    if (!event.droppable) return;
    if (event.droppable?.id !== 'channel-input-' + channelId) return;
    if (event.droppable.node === containerRef) {
      const { track, TrackingEvents } = withAnalytics();
      track(TrackingEvents.BLOCKCHANNEL.ATTACHMENT.DRAG);
    }
    const draggableId = event.draggable?.data.id;
    const draggableName = event.draggable?.data.name;
    const blockName = fileTypeToBlockName(
      event.draggable?.data.fileType ??
        event.draggable?.data.itemType ??
        event.draggable?.data.type,
      true
    );
    if (!blockName || !draggableId || !draggableName) return;
    handleAttach({
      id: draggableId,
      name: draggableName,
      blockName,
    });
  });

  const focusPrevious = () => {
    const tabbableEls = tabbable(blockRef()!);
    const activeEl = document.activeElement;
    if (activeEl === channelWrapperRef() || activeEl === document.body)
      return false;

    const activeElIndex = tabbableEls.indexOf(activeEl as FocusableElement);
    if (activeElIndex !== -1) {
      const prevIndex = activeElIndex - 1;
      if (prevIndex < 0) return false;
      const prevEl = tabbableEls[prevIndex];
      if (!prevEl) return false;
      prevEl.focus();
      return true;
    } else {
      tabbableEls.at(-1)?.focus();
      return true;
    }
  };

  const onChannelInputFocusLeaveStart = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return focusPrevious();
  };

  registerHotkey({
    hotkey: 'enter',
    scopeId: scopeId(),
    description: 'Focus Channel Input',
    keyDownHandler: () => {
      if (channelInputRef()) {
        channelInputRef()?.focus();
        return true;
      }
      return false;
    },
    hotkeyToken: TOKENS.channel.focusInput,
    hide: true,
  });

  registerHotkey({
    hotkey: ['arrowup', 'k', 'shift+tab'],
    scopeId: scopeId(),
    description: 'Focus previous',
    keyDownHandler: () => {
      return focusPrevious();
    },
    hotkeyToken: TOKENS.channel.focusPreviousMessage,
    hide: true,
  });

  registerHotkey({
    hotkey: ['arrowdown', 'j', 'tab'],
    scopeId: scopeId(),
    description: 'Focus next',
    keyDownHandler: () => {
      const tabbableEls = tabbable(blockRef()!);
      const activeEl = document.activeElement;
      const activeElIndex = tabbableEls.indexOf(activeEl as FocusableElement);
      if (activeElIndex !== -1) {
        const nextIndex = activeElIndex + 1;
        if (nextIndex >= tabbableEls.length) return false;
        const nextEl = tabbableEls[nextIndex];
        if (!nextEl) return false;
        nextEl.focus();
        return true;
      }
      return false;
    },
    hotkeyToken: TOKENS.channel.focusNextMessage,
    hide: true,
  });
  const [channelInputRef, setChannelInputRef] = createSignal<
    HTMLDivElement | undefined
  >();
  const [channelWrapperRef, setChannelWrapperRef] = createSignal<
    HTMLDivElement | undefined
  >();
  const [autoFocusOnMount, setAutoFocusOnMount] = createSignal(true);

  const { navigatedFromJK } = useNavigatedFromJK();

  createRenderEffect(() => {
    if (navigatedFromJK()) {
      setAutoFocusOnMount(false);
    }
  });

  onMount(() => {
    if (autoFocusOnMount()) return;
    if (!navigatedFromJK()) return;

    channelWrapperRef()?.focus();
  });

  return (
    <div
      class={`relative flex flex-col w-full h-full bg-panel bracket-never`}
      tabIndex={-1}
      ref={setChannelWrapperRef}
    >
      <ChannelDebouncedNotificationReadMarker
        notificationSource={notificationSource}
        channelId={channelId}
      />
      <StaticMarkdownContext>
        <Top />
        <div
          class="h-full flex flex-col min-h-0 flex-1 relative w-full"
          use:fileDrop={{
            onDrop: (files) => {
              handleFileUpload(files, {
                store: channelInputAttachmentsStore,
                setStore: setChannelInputAttachmentsStore,
                key: channelId,
              });
            },
            onDragStart: (valid) => {
              setIsDraggingOverChannel(true);
              setIsValidChannelDrag(valid);
            },
            onDragEnd: () => {
              setIsDraggingOverChannel(false);
            },
          }}
        >
          <div
            class="absolute pointer-events-none top-1/2 left-1/2 w-[60%] h-full -translate-x-1/2 -translate-y-1/2"
            use:droppable
            ref={containerRef}
          />
          <MessageList
            channelId={channelId}
            messages={channel.messages}
            focusedMessageId={focusedMessageId}
            setFocusedMessageId={setFocusedMessageId}
            targetMessage={targetMessage}
            latestActivity={latestActivity()}
            orderedMessages={orderedMessages}
            setOrderedMessages={setOrderedMessages}
          />
          <div class="shrink-0 w-full px-4 pb-2">
            {/* seamus: note this element is below the scroll so we translate it back to account for the scroll above */}
            <div class="mx-auto -translate-x-1 w-full macro-message-width">
              <ChannelInput
                channelName={channel?.channel?.name ?? ''}
                inputAttachmentsStore={channelInputAttachmentsStore}
                setInputAttachmentsStore={setChannelInputAttachmentsStore}
                inputAttachmentsKey={channelId}
                onFocusLeaveStart={onChannelInputFocusLeaveStart}
                autoFocusOnMount={autoFocusOnMount()}
                domRef={setChannelInputRef}
              />
            </div>
          </div>
        </div>
      </StaticMarkdownContext>
    </div>
  );
}
