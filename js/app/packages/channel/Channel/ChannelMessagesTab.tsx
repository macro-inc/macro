import { Show, type Accessor } from 'solid-js';
import {
  ChannelInput,
  type InputAttachmentTracker,
  type InputSnapshot,
} from '../Input';
import { DebugSuspense } from '@channel/DebugSuspense';
import { ChannelDropZone } from './ChannelDropZone';
import { ChannelThread } from '../Thread';
import { ScrollToBottomOverlay } from './ScrollToBottomOverlay';
import {
  ThreadList,
  type ThreadListNavigation,
  type ThreadListScrollState,
  type ThreadListScrollTarget,
} from './ThreadList';
import type { ChannelInputProps } from '@channel/Input/ChannelInput';
import { makeInputValuePersistenceKey } from '@channel/Input/utils/persistence';
import type { ChannelMessageListMeta, MessageData } from '../Message';
import type { ApiChannelMessage } from '@service-comms/client';
import type { ChannelDragState } from './create-channel-drag-state';
import type { MessageEditor } from './create-message-editor';
import type { NewMessageCheckable } from './util';
import type { ThreadState } from '../Thread/types';
import type { MessageActions } from '../Message';

type ChannelMessagesTabProps = {
  channelId: string;
  messageIndexKeys: Accessor<string[]>;
  messageById: Accessor<Map<string, ApiChannelMessage>>;
  initialScrollTarget: ThreadListScrollTarget;
  shift: Accessor<boolean>;
  isPrepending: Accessor<boolean>;
  onScrollNearTop: () => void;
  onScrollNearBottom: () => void;
  onNavigationReady: (navigation: ThreadListNavigation) => void;
  onScrollStateChange: (state: ThreadListScrollState) => void;
  threadListNavigation: Accessor<ThreadListNavigation | undefined>;
  threadListScrollState: Accessor<ThreadListScrollState | undefined>;
  threadManager: { getOrCreateThreadState: (threadId: string) => ThreadState };
  listMetaByMessageId: Accessor<Record<string, ChannelMessageListMeta>>;
  getMessageActions: (message: MessageData) => MessageActions | undefined;
  pendingTargetReplyId: Accessor<string | undefined>;
  activeTargetMessageReplyId: Accessor<string | undefined>;
  completePendingReplyScroll: (messageId: string, replyId: string) => void;
  highlightedMessageId: Accessor<string | undefined>;
  messageEditor: MessageEditor;
  dismissNewMessages: () => void;
  isNewMessage: (message: NewMessageCheckable) => boolean;
  selectedMessageId: Accessor<string | undefined>;
  messageListScopeId: string;
  dragState: ChannelDragState;
  attachMessageListRef: (element: HTMLDivElement) => void;
  attachInputRef: (element: HTMLDivElement) => void;
  attachmentTracker: InputAttachmentTracker;
  participants: ChannelInputProps['participants'];
  onInputReady: NonNullable<ChannelInputProps['onReady']>;
  onInputChange: (snapshot: InputSnapshot) => void;
  onSend: ChannelInputProps['onSend'];
  onStartTyping: NonNullable<ChannelInputProps['onStartTyping']>;
  onStopTyping: NonNullable<ChannelInputProps['onStopTyping']>;
};

export function ChannelMessagesTab(props: ChannelMessagesTabProps) {
  return (
    <ChannelDropZone dragState={props.dragState}>
      <Show when={props.messageIndexKeys().length > 0}>
        <div
          class="ph-no-capture relative flex-1 min-h-0 suppress-css-brackets suppress-css-bracket outline-none"
          ref={(element) => {
            props.attachMessageListRef(element);
          }}
          tabIndex={-1}
          data-channel-message-list
          data-channel-nav="keyboard"
          onMouseMove={(e) => {
            const el = e.currentTarget;
            if (el.dataset.channelNav !== 'mouse') {
              el.dataset.channelNav = 'mouse';
            }
          }}
        >
          <ThreadList
            keys={props.messageIndexKeys}
            initialScrollTarget={props.initialScrollTarget}
            shift={props.shift}
            prepend={props.isPrepending}
            onScrollNearTop={props.onScrollNearTop}
            onScrollNearBottom={props.onScrollNearBottom}
            onNavigationReady={props.onNavigationReady}
            onScrollStateChange={props.onScrollStateChange}
          >
            {(item) => {
              const message = () => props.messageById().get(item.id);
              const state = props.threadManager.getOrCreateThreadState(item.id);
              const isNewestThread = () =>
                item.id === props.messageIndexKeys().at(-1);

              return (
                <Show when={message()}>
                  {(m) => (
                    <ChannelThread
                      data={m}
                      channelId={() => props.channelId}
                      isNewestThread={isNewestThread()}
                      getMessageActions={props.getMessageActions}
                      targetReplyId={props.pendingTargetReplyId()}
                      highlightedReplyId={props.activeTargetMessageReplyId()}
                      onTargetReplyScrolled={(replyId) => {
                        props.completePendingReplyScroll(m().id, replyId);
                      }}
                      highlighted={m().id === props.highlightedMessageId()}
                      isExpanded={state.isExpanded}
                      setIsExpanded={state.setIsExpanded}
                      isReplying={state.isReplying}
                      setIsReplying={state.setIsReplying}
                      replyInputState={state.replyInputState}
                      setReplyInputState={state.setReplyInputState}
                      listMeta={props.listMetaByMessageId()[item.id]}
                      messageEditor={props.messageEditor}
                      threadActions={{
                        onDismissNewMessages: props.dismissNewMessages,
                      }}
                      isNewMessage={props.isNewMessage}
                      selectedMessageId={props.selectedMessageId}
                      messageListScopeId={props.messageListScopeId}
                    />
                  )}
                </Show>
              );
            }}
          </ThreadList>
          <ScrollToBottomOverlay
            navigation={props.threadListNavigation}
            scrollState={props.threadListScrollState}
          />
        </div>
      </Show>
      <DebugSuspense name="Channel.input">
        <div class="pb-2 w-full flex justify-center" ref={props.attachInputRef}>
          <ChannelInput
            input={{
              mode: 'channel',
              id: `channel-input-${props.channelId}`,
              placeholder: 'Message channel',
              isDraggingOverChannel: props.dragState.isDraggingOverChannel(),
              isValidChannelDrag: props.dragState.isValidChannelDrag(),
            }}
            participants={props.participants}
            attachmentTracker={props.attachmentTracker}
            persistenceKey={makeInputValuePersistenceKey({
              channelId: props.channelId,
            })}
            onReady={props.onInputReady}
            onChange={props.onInputChange}
            onSend={props.onSend}
            onStartTyping={props.onStartTyping}
            onStopTyping={props.onStopTyping}
          />
        </div>
      </DebugSuspense>
    </ChannelDropZone>
  );
}
