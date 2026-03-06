import type { Accessor, Setter } from 'solid-js';
import { ChannelInput } from '../Input';
import type { InputSnapshot } from '../Input';
import { replyInputOffsetX } from './utils/thread-rail-geometry';
import { ThreadReplyInputConnector } from './ThreadReplyInputConnector';

type ThreadReplyInputProps = {
  messageId: string;
  replyInputState: Accessor<InputSnapshot | undefined>;
  setReplyInputState: Setter<InputSnapshot | undefined>;
  setIsReplying: Setter<boolean>;
};

export function ThreadReplyInput(props: ThreadReplyInputProps) {
  return (
    <div class="relative" style={{ 'margin-left': replyInputOffsetX }}>
      <ThreadReplyInputConnector />
      <ChannelInput
        input={{
          id: `thread-reply-input-${props.messageId}`,
          placeholder: 'Send a reply',
          value: props.replyInputState()?.value,
          attachments: props.replyInputState()?.attachments,
          mode: 'reply',
        }}
        markdownNamespace={`thread-reply-input-${props.messageId}-markdown`}
        onChange={(snapshot) => void props.setReplyInputState(snapshot)}
        onCloseDraft={() => {
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
}
