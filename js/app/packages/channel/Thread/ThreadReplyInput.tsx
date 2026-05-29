import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '@channel/Input/utils/persistence';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { useUserId } from '@core/context/user';
import { useSendMessageMutation } from '@queries/channel/message';
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
import { type Accessor, createSignal, onCleanup, type Setter } from 'solid-js';
import { createEntityDropZone } from '../Channel/create-entity-drop-zone';
import type { InputHandle, InputSnapshot } from '../Input';
import { ChannelInput, createInputAttachmentTracker } from '../Input';
import { buildPostMessageSendPayload } from '../Input/message-payload';
import { hasSendableInputContent } from '../Input/utils/sendable-content';
import { ThreadReplyInputConnector } from './ThreadReplyInputConnector';
import { replyInputOffsetX } from './utils/thread-rail-geometry';

type ThreadReplyInputProps = {
  channelId: string;
  messageId: string;
  replyInputState: Accessor<InputSnapshot | undefined>;
  setReplyInputState: Setter<InputSnapshot | undefined>;
  setIsReplying: Setter<boolean>;
  setReplyInputEl?: Setter<HTMLElement | undefined>;
  setReplyInputHandle?: Setter<InputHandle | undefined>;
};

export function ThreadReplyInput(props: ThreadReplyInputProps) {
  onCleanup(() => {
    props.setReplyInputEl?.(undefined);
    props.setReplyInputHandle?.(undefined);
  });

  const userId = useUserId();
  const sendMessageMutation = useSendMessageMutation();
  const typingMutation = usePostTypingUpdateMutation();

  const participants = useChannelParticipants(() => props.channelId);

  const tracker = createInputAttachmentTracker({
    persistenceKey: makeAttachmentTrackerPersistenceKey({
      channelId: props.channelId,
      threadId: props.messageId,
    }),
    initialAttachments: props.replyInputState()?.attachments,
  });

  const entityDropZone = createEntityDropZone({
    droppableId: `thread-reply-entity-drop-${props.messageId}`,
    tracker,
  });

  const [replyInputHandle, setLocalReplyInputHandle] =
    createSignal<InputHandle>();
  const setReplyInputHandle = (handle: InputHandle) => {
    setLocalReplyInputHandle(handle);
    props.setReplyInputHandle?.(handle);

    const snapshot = props.replyInputState();
    if (!snapshot) return;
    requestAnimationFrame(() => handle.restoreSnapshot(snapshot));
  };

  return (
    <div
      class="relative pt-2"
      style={{ 'margin-left': replyInputOffsetX }}
      ref={(el) => props.setReplyInputEl?.(el)}
      data-reply-input
      data-inline-input-container-id={props.messageId}
    >
      <ThreadReplyInputConnector />
      {(() => {
        const droppable = entityDropZone.droppable;
        false && droppable;
        return (
          <div class="relative" use:droppable>
            <ChannelInput
              input={{
                id: `thread-reply-input-${props.messageId}`,
                placeholder: 'Send a reply',
                value: props.replyInputState()?.value,
                attachments: props.replyInputState()?.attachments,
                isDraggingOverChannel: entityDropZone.isDraggingOver(),
                mode: 'reply',
              }}
              participants={participants.users}
              attachmentTracker={tracker}
              persistenceKey={makeInputValuePersistenceKey({
                channelId: props.channelId,
                threadId: props.messageId,
              })}
              markdownNamespace={`thread-reply-input-${props.messageId}-markdown`}
              onReady={setReplyInputHandle}
              onChange={(snapshot) => void props.setReplyInputState(snapshot)}
              onStartTyping={() =>
                typingMutation.mutate({
                  channelId: props.channelId,
                  action: 'start',
                  threadId: props.messageId,
                })
              }
              onStopTyping={() =>
                typingMutation.mutate({
                  channelId: props.channelId,
                  action: 'stop',
                  threadId: props.messageId,
                })
              }
              onClose={() => {
                props.setReplyInputState(undefined);
                props.setIsReplying(false);
              }}
              onSend={(snapshot) => {
                const senderId = userId();
                if (!senderId) return;
                const payload = buildPostMessageSendPayload({
                  snapshot,
                  threadId: props.messageId,
                  participantIds: participants.ids(),
                });

                sendMessageMutation.mutate(
                  {
                    channelID: props.channelId,
                    senderId,
                    optimisticId: crypto.randomUUID(),
                    ...payload,
                  },
                  {
                    onSuccess: () => {
                      props.setReplyInputState(undefined);
                      props.setIsReplying(false);
                    },
                    onError: () => {
                      const handle = replyInputHandle();
                      if (!handle) return;
                      const current = props.replyInputState();
                      if (current && hasSendableInputContent(current)) return;
                      handle.restoreSnapshot(snapshot);
                    },
                  }
                );
              }}
            />
          </div>
        );
      })()}
    </div>
  );
}
