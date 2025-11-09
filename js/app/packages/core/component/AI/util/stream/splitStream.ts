import type { StreamItem } from '@service-cognition/websocket';
import type { Splitter } from './types';

export const noSplit: Splitter = (items) => items;

export const characters: (n: number) => Splitter = (n) => (items) => {
  const splitItems: StreamItem[] = [];
  for (const item of items) {
    if (item.type === 'chat_message_response' && item.content.type === 'text') {
      const chunks = [];
      let group = '';

      for (const char of item.content.text) {
        group += char;
        if (group.length === n) {
          chunks.push(group);
          group = '';
        }
      }

      if (group) chunks.push(group); // push the le
      chunks.forEach((chunk) => {
        splitItems.push({
          type: 'chat_message_response',
          chat_id: item.chat_id,
          content: {
            type: 'text',
            text: chunk,
          },
          message_id: item.message_id,
          stream_id: item.stream_id,
        });
      });
    } else {
      splitItems.push(item);
    }
  }

  return splitItems;
};
