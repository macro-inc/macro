import { For } from 'solid-js';
import {
  ChannelMessage,
  type MessageActions,
  type MessageData,
} from '../Message';
import type { ApiThreadReply } from '@service-comms/client';
import { InlineMessageEditor } from '../Channel/InlineMessageEditor';
import type { MessageEditing } from './types';

export function ThreadReplyList(props: {
  channelId: string;
  threadId: string;
  replies: Array<ApiThreadReply>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  editing?: MessageEditing;
}) {
  return (
    <For each={props.replies}>
      {(reply) => {
        const replyMessage = () => ({
          ...reply,
          thread_id: props.threadId,
        });

        return (
          <>
            {props.editing?.state()?.messageId === reply.id ? (
              <InlineMessageEditor
                channelId={props.channelId}
                message={reply}
                snapshot={
                  props.editing.state()?.snapshot ?? {
                    value: '',
                    mentions: [],
                    attachments: [],
                  }
                }
                onChange={(snapshot) =>
                  props.editing?.update(replyMessage(), snapshot)
                }
                onCancel={() => props.editing?.cancel(reply.id)}
                onSave={(snapshot) =>
                  props.editing?.save(replyMessage(), snapshot)
                }
              />
            ) : (
              <ChannelMessage
                message={reply}
                actions={props.getMessageActions?.(replyMessage())}
              />
            )}
          </>
        );
      }}
    </For>
  );
}
