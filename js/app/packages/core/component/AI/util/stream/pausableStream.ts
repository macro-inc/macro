import type { ChatMessageStream } from '@service-connection/stream';
import type { Accessor } from 'solid-js';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import type { StreamItem } from '.';
import { MOCK_ID } from './mockStream';

export interface PausableStreamOptions {
  isPaused: Accessor<boolean>;
  isSlow: Accessor<boolean>;
  onChunk?: (text: string) => void;
  fastDelayMs?: number;
  slowDelayMs?: number;
}

export function pausableStream(
  source: ChatMessageStream,
  options: PausableStreamOptions
): ChatMessageStream {
  const {
    isPaused,
    isSlow,
    onChunk,
    fastDelayMs = 15,
    slowDelayMs = 150,
  } = options;

  const [messages, setMessages] = createSignal<StreamItem[]>([]);
  const [isDone, setIsDone] = createSignal(false);
  const [isClosed, _setIsClosed] = createSignal(false);

  let emittedCount = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const extractText = (item: StreamItem): string | undefined => {
    if (item.type === 'chat_message_response' && item.content.type === 'text') {
      return item.content.text;
    }
    return undefined;
  };

  const scheduleNext = () => {
    if (isClosed() || isDone()) return;

    const delay = isSlow() ? slowDelayMs : fastDelayMs;
    timeoutId = setTimeout(processNext, delay);
  };

  const processNext = () => {
    if (isClosed()) return;

    if (isPaused()) {
      timeoutId = setTimeout(processNext, 50);
      return;
    }

    const sourceData = source.data();

    if (emittedCount < sourceData.length) {
      const item = sourceData[emittedCount];
      if (item && 'stream_id' in item && item.stream_id === MOCK_ID) {
        if (item.type !== 'stream_end') {
          setMessages((prev) => [...prev, item]);
          const text = extractText(item);
          if (text && onChunk) {
            onChunk(text);
          }
        }
      }
      emittedCount++;
      scheduleNext();
    } else if (source.isDone()) {
      setIsDone(true);
    } else {
      timeoutId = setTimeout(processNext, 50);
    }
  };

  createEffect(
    on(
      () => source.data().length,
      () => {
        if (timeoutId === undefined && !isDone() && !isClosed()) {
          processNext();
        }
      }
    )
  );

  onCleanup(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

  return {
    data: messages,
    isDone,
    id: () => ({
      entity_id: MOCK_ID,
      stream_id: MOCK_ID,
      entity_type: 'chat',
    }),
  };
}
