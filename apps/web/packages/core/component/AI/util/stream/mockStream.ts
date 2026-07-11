import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { ChatMessageStream } from '@service-connection/stream';
import { uuid } from 'short-uuid';
import { createEffect, createSignal } from 'solid-js';
import { characters } from './splitStream';
import type { NetworkDelay, Splitter } from './types';

type Response =
  | { type: 'text'; text: string }
  | { type: 'toolCall'; tool: Omit<NamedTool, 'id'> }
  | { type: 'toolResponse'; tool: Omit<NamedTool, 'id'> };

type StreamItem = ReturnType<ChatMessageStream['data']>[number];

// type Message = { type: 'userMessage'; text: string } | Response;
export const MOCK_ID = 'mock';

const mock_id = () => ({
  stream_id: MOCK_ID,
  entity_id: MOCK_ID,
  entity_type: 'chat' as const,
});

function baseStream(items: StreamItem[]): ChatMessageStream {
  const [messages, setMessages] = createSignal<StreamItem[]>([]);
  const [isDone, setIsDone] = createSignal(false);
  const [isClosed, _setIsClosed] = createSignal(false);

  const handleMessage = (data: StreamItem) => {
    if (isClosed()) return;
    if (!('stream_id' in data)) return;
    if (data.stream_id !== MOCK_ID) return;
    if (data.type === 'stream_end') {
      setIsDone(true);
    } else {
      setMessages((p) => [...p, data]);
    }
  };

  items.forEach((item) => {
    handleMessage(item);
  });

  return {
    data: messages,
    isDone: isDone,
    id: mock_id,
  };
}

export function delayStream(
  stream: ChatMessageStream,
  delay: NetworkDelay
): ChatMessageStream {
  const [messages, setMessages] = createSignal<StreamItem[]>([]);
  const [isDone, setIsDone] = createSignal(false);
  const [isClosed, _setIsClosed] = createSignal(false);
  let totalDelay = 0;

  const handleMessage = (data: StreamItem) => {
    if (isClosed()) return;
    if (!('stream_id' in data)) return;
    if (data.stream_id !== MOCK_ID) return;
    if (data.type === 'stream_end') {
      setIsDone(true);
    } else {
      setMessages((p) => [...p, data]);
    }
  };

  createEffect(() => {
    if (!stream.isDone()) return;

    const data = stream.data();
    data.forEach((chunk, i) => {
      const later = totalDelay + delay(i);
      setTimeout(() => handleMessage(chunk), later);
      totalDelay += delay(i);
    });
    setTimeout(() => setIsDone(true), totalDelay);
  });

  return {
    data: messages,
    isDone,
    id: mock_id,
  };
}

// stop a stream at chunk n
function _limitStream(
  stream: ChatMessageStream,
  itemLimit: number
): ChatMessageStream {
  const [data, setData] = createSignal<StreamItem[]>(stream.data());
  const [isDone, setIsDone] = createSignal<boolean>(stream.isDone());

  createEffect(() => {
    const data = stream.data();
    if (data.length > itemLimit) return;
    setData(data);
    setIsDone(stream.isDone());
  });

  return {
    data,
    isDone,
    id: mock_id,
  };
}

export function blockDone(stream: ChatMessageStream): ChatMessageStream {
  return {
    isDone: () => false,
    data: stream.data,
    id: mock_id,
  };
}

function splitStream(
  stream: ChatMessageStream,
  split: Splitter
): ChatMessageStream {
  const [messages, setMessages] = createSignal<StreamItem[]>([]);

  createEffect(() => {
    const data = stream.data();
    const splitMessages = split(data);
    setMessages(splitMessages);
  });

  return {
    data: messages,
    isDone: stream.isDone,
    id: mock_id,
  };
}

type WithType<T> = T extends { type: any } ? T : never;
type AssistantResponse = Extract<
  WithType<StreamItem>,
  { type: 'chat_message_response' }
>;

function baseMessage(): Omit<AssistantResponse, 'content'> {
  return {
    type: 'chat_message_response',
    chat_id: MOCK_ID,
    message_id: uuid(),
    stream_id: MOCK_ID,
  };
}

function makeItems(response: Response[]): StreamItem[] {
  const messages = response.map((thing) => {
    if (thing.type === 'text') return assistantText(thing.text);
    else if (thing.type === 'toolCall') return toolCall(thing.tool);
    else return toolResponse(thing.tool);
  });

  return [...messages, { type: 'stream_end', stream_id: MOCK_ID }];
}

export function createStream(
  assistantResponse: Response[],
  splitter: Splitter = characters(4)
): ChatMessageStream {
  const items = makeItems(assistantResponse);
  const stream = baseStream(items);
  return splitStream(stream, splitter);
}

function assistantText(content: string): AssistantResponse {
  return {
    ...baseMessage(),
    content: {
      type: 'text',
      text: content,
    },
  };
}

const toolId = (() => {
  let last: 'call' | 'response' = 'call';
  let id = 0;
  return (t: 'call' | 'response') => {
    if (t === last || last === 'response') {
      id++;
    }
    last = t;
    return `${id}`;
  };
})();

function toolCall(tool: Omit<NamedTool, 'id'>): AssistantResponse {
  return {
    ...baseMessage(),
    content: {
      type: 'toolCall',
      id: toolId('call'),
      json: tool.data,
      name: tool.name,
    },
  };
}

function toolResponse(response: Omit<NamedTool, 'id'>): AssistantResponse {
  return {
    ...baseMessage(),
    content: {
      type: 'toolCallResponseJson',
      id: toolId('response'),
      json: response.data,
      name: response.name,
    },
  };
}
