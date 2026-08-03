import type {
  AssistantMessagePart,
  ChatMessageWithAttachments,
} from '@core/component/AI/types';
import type { ChatMessageStream } from '@service-connection/stream';

type StreamItem = ReturnType<ChatMessageStream['data']>[number];

// transform the stream to chat message
// a stream represents a single assistant response
export function asChatMessage(
  items: StreamItem[]
): ChatMessageWithAttachments | undefined {
  if (items.length === 0) return;

  /*
   Build in place instead of `[...acc.slice(0, -1), x]` / `[...acc, x]`: those
   copied every part accumulated so far on every single item, regardless of
   whether it merged into the last part. Plain text stays cheap either way
   (it all merges into one entry), but a message with many tool calls never
   merges — each one grows the accumulator — so the old approach cost
   O(n^2) per call, compounding into O(n^3) since the caller re-invokes this
   over the whole stream on every incoming chunk.
  */
  const newMessageParts: AssistantMessagePart[] = [];
  for (const item of items) {
    // ignore other message types
    if (item.type !== 'chat_message_response') continue;
    const last = newMessageParts[newMessageParts.length - 1];

    if (last?.type === 'text' && item.content.type === 'text') {
      last.text += item.content.text;
    } else if (last?.type === 'thinking' && item.content.type === 'thinking') {
      last.thinking += item.content.thinking;
    } else {
      // shallow copy: a later merge mutates `last` in place, and must never
      // touch the stream's own (otherwise-immutable) part objects
      newMessageParts.push({ ...item.content });
    }
  }

  const message = items.find((msg) => msg.type === 'chat_message_response');
  if (!message) return;
  const id = message.message_id;

  return {
    // assistant messages never have attachments
    attachments: [],
    content: newMessageParts,
    role: 'assistant',
    id: id,
  };
}
