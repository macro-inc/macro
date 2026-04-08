import type { ChatStream } from '@service-cognition/generated/schemas';
import type { Accessor } from 'solid-js';
import { createEffect, on } from 'solid-js';
import { triggerToolCall } from '../component/tool/handler';

type StreamLike = { data: Accessor<ChatStream[]> };

export function registerToolHandler(stream: () => StreamLike | undefined) {
  createEffect(
    on(
      [stream, () => stream()?.data()],

      async () => {
        const streamData = stream();
        if (!streamData) return;
        const latest = streamData.data().at(-1);
        if (!latest) return;
        if (
          latest.type === 'chat_message_response' &&
          latest.content.type === 'toolCall'
        ) {
          await triggerToolCall({
            chat_id: latest.chat_id,
            json: latest.content.json,
            message_id: latest.message_id,
            name: latest.content.name,
            part_index: -1,
            tool_id: latest.content.id,
            type: 'call',
          });
        } else if (
          latest.type === 'chat_message_response' &&
          latest.content.type === 'toolCallResponseJson'
        ) {
          await triggerToolCall({
            chat_id: latest.chat_id,
            json: latest.content.json,
            message_id: latest.message_id,
            name: latest.content.name,
            part_index: -1,
            tool_id: latest.content.id,
            type: 'response',
          });
        }
      }
    )
  );
}
