import { For, createMemo } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';
import { MarkMessaageNotifications } from '@notifications/components/MarkMessageNotifications';
import { buildThreadReplyListMeta } from './reply-list-meta';
import { ThreadRail } from './ThreadRail';
import { useActivityTracker } from '@channel/activity-tracker-context';

export function ThreadReplyList(props: {
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  channelId: string;
}) {
  const { isNewMessage } = useActivityTracker();
  const listMetaByReplyId = createMemo(() =>
    buildThreadReplyListMeta(props.replies, isNewMessage)
  );

  return (
    <For each={props.replies}>
      {(reply) => {
        const replyMessage = () => ({
          ...reply,
          thread_id: props.threadId,
        });

        return (
          <div class="relative">
            <ThreadRail
              newMessage={listMetaByReplyId()[reply.id].isNewMessage}
            />
            <MarkMessaageNotifications
              messageId={reply.id}
              channelId={props.channelId}
            >
              <ChannelMessage
                message={reply}
                actions={props.getMessageActions?.(replyMessage())}
                listMeta={listMetaByReplyId()[reply.id]}
              />
            </MarkMessaageNotifications>
          </div>
        );
      }}
    </For>
  );
}
