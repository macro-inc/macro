import type { ChatStream } from '@service-cognition/generated/schemas';
import type { Accessor } from 'solid-js';
import { createEffect, createSignal } from 'solid-js';

type StreamLike = { data: Accessor<ChatStream[]> };

type Extended<T, U> = T & U;

export interface TimedStream {
  timeToFirstMessageMs: () => undefined | number;
}

export function timeStream<T extends StreamLike>(
  stream: T
): Extended<T, TimedStream> {
  const start = Date.now();
  const [ttf, setTtf] = createSignal<number>();
  createEffect(() => {
    if (ttf() !== undefined) return;
    const data = stream.data();
    if (data.length) {
      setTtf(Date.now() - start);
    }
  });
  return {
    ...stream,
    timeToFirstMessageMs: ttf,
  };
}

export interface IddStream {
  messageId: () => undefined | string;
}

export function idStream<T extends StreamLike>(
  stream: T
): Extended<T, IddStream> {
  const [id, setMessageId] = createSignal<string>();
  createEffect(() => {
    if (id()) return;
    const data = stream.data();
    const messageId = data.find(
      (part) => part.type === 'chat_message_response'
    )?.message_id;
    setMessageId(messageId);
  });
  return {
    ...stream,
    messageId: id,
  };
}
