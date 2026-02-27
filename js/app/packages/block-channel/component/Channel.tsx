import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useNavigatedFromJK } from '@app/component/useNavigatedFromJK';
import { URL_PARAMS } from '@block-channel/constants';
import { handleFileUpload } from '@block-channel/utils/inputAttachments';
import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import type { EntityDragEvent } from '@entity';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useChannelActivity } from '@core/context/channels';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import { TOKENS } from '@core/hotkey/tokens';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { createTabFocusEffect } from '@core/signal/tabFocus';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import { handleFileFolderDrop } from '@core/util/upload';
import {
  ChannelDebouncedNotificationReadMarker,
  makeDebouncedChannelNotificationReadMarker,
  createEffectOnEntityTypeNotification,
  useEntityHasUnreadNotifications,
} from '@notifications';
import {
  invalidateChannelsActivity,
  useUpdateChannelsActivityMutation,
} from '@queries/channel/activity';
import type { Message } from '@queries/channel/types';
import { connectionGatewayClient } from '@service-connection/client';
import { useBeforeLeave, useSearchParams } from '@solidjs/router';
import { createDroppable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { toast } from 'core/component/Toast/Toast';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { createMethodRegistration } from 'core/orchestrator';
import {
  createEffect,
  createRenderEffect,
  createSignal,
  on,
  onMount,
  Suspense,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { type FocusableElement, tabbable } from 'tabbable';
import { ChannelInput } from './ChannelInput';
import {
  MessageList,
  type MessageListNavigation,
  type TargetMessageInfo,
} from './MessageList/MessageList';
import { Top } from './Top';
import { ModalsProvider } from './ModalsProvider';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { useChannelContext } from '@block-channel/hooks/channel';
import { FloatingInputLoader } from '@core/component/FloatingInputLoader';
import {
  invalidateChannelWithID,
  useChannelQuery,
} from '@queries/channel/channel';

false && fileFolderDrop;

/** Tracks channel entity when tab regains focus (throttled to 10s) */
function createChannelTrackingEffect(channelId: string) {
  let lastTrackTime = Date.now();
  const TRACK_THROTTLE_MS = 10_000;

  createTabFocusEffect((isTabFocused) => {
    if (isTabFocused && Date.now() - lastTrackTime > TRACK_THROTTLE_MS) {
      connectionGatewayClient.trackEntity({
        entity_type: 'channel',
        entity_id: channelId,
        action: 'open',
      });
      lastTrackTime = Date.now();
    }
  });
}

export function Channel(props: {
  channelId: string;
  target?: TargetMessageInfo;
}) {
  const channelContext = useChannelContext();
  const channelQuery = useChannelQuery(() => props.channelId);
  const latestActivity = useChannelActivity(props.channelId);

  const [openedChannel, setOpenedChannel] = createSignal<Date>();

  const updateActivityMutation = useUpdateChannelsActivityMutation({
    onSuccess: () => {
      invalidateChannelsActivity();
    },
  });

  const updateActivityOnOpen = () => {
    setOpenedChannel(new Date());
    updateActivityMutation.mutate({
      channelId: props.channelId,
      activityType: 'view',
    });
  };

  const updateActivityOnClose = () =>
    updateActivityMutation.mutate({
      channelId: props.channelId,
      activityType: 'view',
    });

  const { track } = withAnalytics();
  let containerRef!: HTMLDivElement;
  const [searchParams] = useSearchParams();
  const [channelInputAttachmentsStore, setChannelInputAttachmentsStore] =
    createStore<Record<string, InputAttachment[]>>({});
  // All messages, including threads, in order of how they should be displayed, i.e. thread children are placed after their parent message
  const [orderedMessages, setOrderedMessages] = createSignal<Message[]>([]);
  const scopeId = blockHotkeyScopeSignal.get;
  const blockRef = blockElementSignal.get;
  const [isDraggingOverChannel, setIsDraggingOverChannel] = createSignal(false);
  const [isValidChannelDrag, setIsValidChannelDrag] = createSignal(true);
  const notificationSource = useGlobalNotificationSource();

  const blockHandle = blockHandleSignal.get;

  // use props if available, fallback to search params
  const initialTargetMessage = (): TargetMessageInfo | undefined => {
    const target = props.target;
    if (target) return target;

    const messageId = searchParams[URL_PARAMS.message];
    const threadId = searchParams[URL_PARAMS.thread];

    if (!messageId) return;

    return {
      messageId: Array.isArray(messageId) ? messageId[0] : messageId,
      threadId: Array.isArray(threadId) ? threadId[0] : threadId,
    };
  };

  const [targetMessage, setTargetMessage] = createSignal<
    TargetMessageInfo | undefined
  >(initialTargetMessage());

  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      const threadId = params[URL_PARAMS.thread] as string | undefined;
      const messageId = params[URL_PARAMS.message] as string | undefined;
      if (messageId) {
        setTargetMessage({
          messageId,
          threadId,
        });
      }
    },
  });

  const [selectedMessageId, setSelectedMessageId] = createSignal<
    string | undefined
  >(undefined);

  const [messageListNav, setMessageListNav] =
    createSignal<MessageListNavigation>();

  onMount(() => {
    updateActivityOnOpen();

    track(TrackingEvents.BLOCKCHANNEL.CHANNEL.OPEN);

    const STALE_THRESHOLD_MS = 1_000;
    const age = Date.now() - channelQuery.dataUpdatedAt;
    if (age > STALE_THRESHOLD_MS) {
      invalidateChannelWithID(props.channelId);
    }
  });

  createChannelTrackingEffect(props.channelId);

  useBeforeLeave(() => {
    updateActivityOnClose();
  });

  const droppable = createDroppable('channel-input-' + props.channelId);

  false && droppable;

  const [, { onDragEnd }] = useDragDropContext() ?? [
    undefined,
    { onDragEnd: () => {} },
  ];

  function handleAttach(attachment: InputAttachment) {
    const list = channelInputAttachmentsStore[props.channelId] ?? [];
    if (list.find((a) => a.id === attachment.id))
      return toast.failure('Attachment already attached');
    if (list.length >= 10)
      return toast.failure('You can only attach up to 10 files at a time');
    setChannelInputAttachmentsStore(props.channelId, (prev = []) => [
      ...prev,
      attachment,
    ]);
  }

  onDragEnd((event: EntityDragEvent) => {
    if (!event.droppable) return;
    if (event.droppable?.id !== 'channel-input-' + props.channelId) return;
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

  /**
   * Hybrid navigation: tries DOM-based tabbable navigation first,
   * falls back to message ID navigation if element was unmounted (which can happen if you're moving rapidly with virtualization)
   */
  const navigateChannel = (direction: 'previous' | 'next') => {
    const block = blockRef();
    if (!block) return false;

    const tabbableEls = tabbable(block);
    let activeEl = document.activeElement;

    const selectedMessageEl = block.querySelector(
      `[data-message-id="${selectedMessageId()}"]`
    );

    if (selectedMessageEl && !selectedMessageEl?.contains(activeEl)) {
      // Selected message gets set on hover without actually becoming focused. If the active element is not inside the selected message, it is probably because the user has hovered over a new message, and so we should proceed as if the selected message were the active element.
      activeEl = selectedMessageEl;
    }

    const activeElIndex = tabbableEls.indexOf(activeEl as FocusableElement);

    // DOM-based navigation: element is in tabbable list
    if (activeElIndex !== -1) {
      const targetIndex =
        direction === 'previous' ? activeElIndex - 1 : activeElIndex + 1;

      if (targetIndex >= 0 && targetIndex < tabbableEls.length) {
        const targetEl = tabbableEls[targetIndex];
        targetEl?.focus();
        return;
      }
    }

    // Fallback: element not in tabbable list (this can happen if moving too quickly thru the virtualized list)
    // Use message ID-based navigation
    const nav = messageListNav();
    if (nav) {
      return direction === 'previous'
        ? nav.navigatePrevious()
        : nav.navigateNext();
    }
  };

  const onChannelInputFocusLeaveStart = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return navigateChannel('previous');
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
    hotkeyToken: TOKENS.block.focus,
    hide: true,
  });

  registerHotkey({
    hotkey: ['arrowup', 'shift+tab'],
    scopeId: scopeId(),
    description: 'Focus previous',
    keyDownHandler: () => {
      navigateChannel('previous');
      return true;
    },
    hotkeyToken: TOKENS.channel.focusPreviousMessage,
    hide: true,
  });

  registerHotkey({
    hotkey: ['arrowdown', 'tab'],
    scopeId: scopeId(),
    description: 'Focus next',
    keyDownHandler: () => {
      navigateChannel('next');
      return true;
    },
    hotkeyToken: TOKENS.channel.focusNextMessage,
    hide: true,
  });
  const [channelInputRef, setChannelInputRef] = createSignal<
    HTMLDivElement | undefined
  >();
  const [autoFocusOnMount, setAutoFocusOnMount] = createSignal(true);

  const { navigatedFromJK } = useNavigatedFromJK();

  createRenderEffect(() => {
    if (navigatedFromJK()) {
      setAutoFocusOnMount(false);
    }
  });

  const debouncedMarkAsRead = makeDebouncedChannelNotificationReadMarker({
    notificationSource: notificationSource,
    channelId: props.channelId,
    debounceTime: 500,
  });

  // Listen for any incoming notifications and while the panel is active,
  // mark them as read
  createEffectOnEntityTypeNotification(
    notificationSource,
    'channel',
    (notification) => {
      if (
        !splitContext.isPanelActive() ||
        notification.entity_id !== props.channelId
      ) {
        return;
      }

      debouncedMarkAsRead();
    }
  );

  const hasNotifications = useEntityHasUnreadNotifications(notificationSource, {
    type: 'channel',
    id: props.channelId,
  });

  const splitContext = useSplitPanelOrThrow();

  // Track panel active state. When the panel is focused and it was not previously
  // mark notifications as read if there are any
  createEffect(
    on(splitContext.isPanelActive, (isPanelActive, wasPanelActive) => {
      if (wasPanelActive !== false) return;

      if (!isPanelActive || !hasNotifications()) {
        return;
      }

      debouncedMarkAsRead();
    })
  );

  return (
    <div
      class={`relative flex flex-col w-full h-full bg-panel bracket-never`}
      tabIndex={-1}
    >
      <ChannelDebouncedNotificationReadMarker
        notificationSource={notificationSource}
        channelId={props.channelId}
        debounceTime={500}
      />
      <StaticMarkdownContext>
        <ModalsProvider>
          <Suspense>
            <Top
              channelId={props.channelId}
              channelType={channelContext.channelType()}
              participants={channelContext.channel()?.participants ?? []}
              channelName={channelContext.channelName()}
            />
          </Suspense>
          <div
            class="h-full flex flex-col min-h-0 flex-1 relative w-full"
            use:fileFolderDrop={{
              onDrop: (files, folders) => {
                handleFileFolderDrop(files, folders, (uploadEntries) =>
                  handleFileUpload(uploadEntries, {
                    store: channelInputAttachmentsStore,
                    setStore: setChannelInputAttachmentsStore,
                    key: props.channelId,
                  })
                );
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
            <FloatingInputLoader
              minShowTime={200}
              successDuration={100}
              isLoading={() => channelQuery.isFetching}
              loadingText="Refreshing messages"
              class="top-0 bottom-auto mt-2 mb-0 z-10"
            />
            <MessageList
              channelId={props.channelId}
              messages={channelContext.messages()}
              threads={channelContext.threads()}
              reactions={channelContext.reactions()}
              attachments={channelContext.attachments()}
              participants={channelContext.channel()?.participants ?? []}
              focusedMessageId={selectedMessageId}
              setFocusedMessageId={setSelectedMessageId}
              targetMessage={targetMessage}
              latestActivity={latestActivity()}
              openedChannel={openedChannel()}
              orderedMessages={orderedMessages}
              setOrderedMessages={setOrderedMessages}
              onNavigationReady={setMessageListNav}
            />
            <div class="shrink-0 w-full pb-2 @min-[40rem]:px-4">
              {/* seamus: note this element is below the scroll so we translate it back to account for the scroll above */}
              <div class="mx-auto w-full macro-message-width macro-message-padding">
                <Suspense>
                  <ChannelInput
                    channelId={props.channelId}
                    channelName={channelContext.channelName()}
                    participants={channelContext.channel()?.participants ?? []}
                    inputAttachmentsStore={channelInputAttachmentsStore}
                    setInputAttachmentsStore={setChannelInputAttachmentsStore}
                    inputAttachmentsKey={props.channelId}
                    onFocusLeaveStart={onChannelInputFocusLeaveStart}
                    autoFocusOnMount={autoFocusOnMount()}
                    domRef={setChannelInputRef}
                    isDraggingOverChannel={isDraggingOverChannel}
                    isValidChannelDrag={isValidChannelDrag}
                  />
                </Suspense>
              </div>
            </div>
          </div>
        </ModalsProvider>
      </StaticMarkdownContext>
    </div>
  );
}
