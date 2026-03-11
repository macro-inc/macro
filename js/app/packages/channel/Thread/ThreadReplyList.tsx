import { For } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';
import { MarkMessaageNotifications } from '@notifications/components/MarkMessageNotificationsAsSeen';

export function ThreadReplyList(props: {
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  channelId: string;
}) {
  return (
    <For each={props.replies}>
      {(reply) => (
        <MarkMessaageNotifications
          messageId={reply.id}
          channelId={props.channelId}
        >
          <ChannelMessage
            message={reply}
            actions={props.getMessageActions?.(reply)}
          />
        </MarkMessaageNotifications>
      )}
    </For>
  );
}
