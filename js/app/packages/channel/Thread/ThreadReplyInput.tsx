import type { Accessor, Setter } from 'solid-js';
import { ChannelInput, createInputAttachmentTracker } from '../Input';
import type { InputSnapshot } from '../Input';
import { createEntityDropZone } from '../Channel/create-entity-drop-zone';
import { replyInputOffsetX } from './utils/thread-rail-geometry';
import { ThreadReplyInputConnector } from './ThreadReplyInputConnector';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '@channel/Input/utils/persistence';

type ThreadReplyInputProps = {
  channelId: string;
  messageId: string;
  replyInputState: Accessor<InputSnapshot | undefined>;
  setReplyInputState: Setter<InputSnapshot | undefined>;
  setIsReplying: Setter<boolean>;
};

export function ThreadReplyInput(props: ThreadReplyInputProps) {
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
    <div class="relative" style={{ 'margin-left': replyInputOffsetX }}>
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
              attachmentTracker={tracker}
              persistenceKey={makeInputValuePersistenceKey({
                channelId: props.channelId,
                threadId: props.messageId,
              })}
              markdownNamespace={`thread-reply-input-${props.messageId}-markdown`}
              onChange={(snapshot) => void props.setReplyInputState(snapshot)}
              onClose={() => {
                props.setReplyInputState(undefined);
                props.setIsReplying(false);
              }}
              onSend={async () => {
                props.setReplyInputState(undefined);
                props.setIsReplying(false);
              }}
            />
          </div>
        );
      })()}
    </div>
  );
}
