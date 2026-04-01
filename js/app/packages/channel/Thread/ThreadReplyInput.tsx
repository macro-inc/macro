import { useMobileChannelInputVisibility } from '@channel/Channel/mobile-channel-input-visibility';
import { useUserId } from '@core/context/user';
import { useSendMessageMutation } from '@queries/channel/message';
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
import type { Accessor, Setter } from 'solid-js';
import { ChannelInput, createInputAttachmentTracker } from '../Input';
import type { InputSnapshot } from '../Input';
import { buildPostMessageRequest } from '../Input/message-payload';
import { createEntityDropZone } from '../Channel/create-entity-drop-zone';
import { replyInputOffsetX } from './utils/thread-rail-geometry';
import { ThreadReplyInputConnector } from './ThreadReplyInputConnector';
import { scrollReplyInputAboveKeyboard } from '../scroll-utils';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '@channel/Input/utils/persistence';
import { useChannelParticipants } from '@channel/use-channel-participants';

type ThreadReplyInputProps = {
  channelId: string;
  messageId: string;
  replyInputState: Accessor<InputSnapshot | undefined>;
  setReplyInputState: Setter<InputSnapshot | undefined>;
  setIsReplying: Setter<boolean>;
};

export function ThreadReplyInput(props: ThreadReplyInputProps) {
  const mobileChannelInputVisibility = useMobileChannelInputVisibility();
  let keyboardWillShowHandler: ((e: Event) => void) | undefined;
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

  return (
    <div
      class="relative pt-2"
      style={{ 'margin-left': replyInputOffsetX }}
      onFocusIn={() => {
        mobileChannelInputVisibility?.hide();
        keyboardWillShowHandler = (event: Event) => {
          const height =
            (event as CustomEvent<{ height: number }>).detail?.height ?? 0;
          scrollReplyInputAboveKeyboard(props.messageId, height);
          keyboardWillShowHandler = undefined;
        };
        window.addEventListener('keyboardWillShow', keyboardWillShowHandler, {
          once: true,
        });
      }}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          mobileChannelInputVisibility?.show();
          if (keyboardWillShowHandler) {
            window.removeEventListener(
              'keyboardWillShow',
              keyboardWillShowHandler
            );
            keyboardWillShowHandler = undefined;
          }
        }
      }}
      data-reply-input
      data-reply-input-id={props.messageId}
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

                sendMessageMutation.mutate({
                  channelID: props.channelId,
                  senderId,
                  optimisticId: crypto.randomUUID(),
                  message: buildPostMessageRequest({
                    snapshot,
                    threadId: props.messageId,
                    participantIds: participants.ids(),
                  }),
                });

                props.setReplyInputState(undefined);
              }}
            />
          </div>
        );
      })()}
    </div>
  );
}
