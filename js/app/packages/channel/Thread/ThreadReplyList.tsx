import { For } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';

export function ThreadReplyList(props: {
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
}) {
  return (
    <For each={props.replies}>
      {(reply) => (
        <ChannelMessage
          message={reply}
          actions={props.getMessageActions?.(reply)}
        />
      )}
    </For>
  );
}
