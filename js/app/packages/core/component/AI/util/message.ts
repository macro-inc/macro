import type {
  AssistantMessagePart,
  ChatMessageWithAttachments,
  StreamItem,
} from '@core/component/AI/types';

// transform the stream to chat message
// a stream represents a single assistant response
export function asChatMessage(
  items: StreamItem[]
): ChatMessageWithAttachments | undefined {
  if (items.length === 0) return;

  const newMessageParts: AssistantMessagePart[] = items.reduce((acc, item) => {
    // ignore other message types
    if (item.type !== 'chat_message_response') return acc;
    if (acc.length === 0) {
      return [item.content];
    }
    const last = acc[acc.length - 1];

    if (last.type === 'text' && item.content.type === 'text') {
      return [
        ...acc.slice(0, -1),
        {
          type: 'text',
          text: last.text + item.content.text,
        },
      ];
    } else {
      return [...acc, item.content];
    }
  }, [] as AssistantMessagePart[]);

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
