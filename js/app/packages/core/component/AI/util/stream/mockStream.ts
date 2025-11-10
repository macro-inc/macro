import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { MessageStream, StreamItem } from '@service-cognition/websocket';
import { uuid } from 'short-uuid';
import { createEffect, createSignal } from 'solid-js';
import { DEFAULT_MODEL } from '../../constant';
import { characters } from './splitStream';
import type { NetworkDelay, Splitter } from './types';

type Response =
  | { type: 'text'; text: string }
  | { type: 'toolCall'; tool: Omit<NamedTool, 'id'> }
  | { type: 'toolResponse'; tool: Omit<NamedTool, 'id'> };

// type Message = { type: 'userMessage'; text: string } | Response;
export const MOCK_ID = 'mock';

const makeFakeRequst = () =>
  ({
    chat_id: MOCK_ID,
    content: 'test',
    model: DEFAULT_MODEL,
    type: 'send_chat_message',
    token: '??',
    stream_id: MOCK_ID,
  }) satisfies MessageStream['request'];

function baseStream(items: StreamItem[]): MessageStream {
  const [messages, setMessages] = createSignal<StreamItem[]>([]);
  const [isDone, setIsDone] = createSignal(false);
  const [isClosed, setIsClosed] = createSignal(false);

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

  items.forEach((item) => handleMessage(item));

  return {
    close: () => {
      setIsClosed(true);
      setIsDone(true);
    },
    data: messages,
    isDone: isDone,
    // TODO
    isErr: () => false,
    request: makeFakeRequst(),
    err: () => undefined,
  };
}

export function delayStream(
  stream: MessageStream,
  delay: NetworkDelay
): MessageStream {
  const [messages, setMessages] = createSignal<StreamItem[]>([]);
  const [isDone, setIsDone] = createSignal(false);
  const [isClosed, setIsClosed] = createSignal(false);
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
    close: () => {
      setIsDone(true);
      setIsClosed(true);
    },
    data: messages,
    isDone,
    isErr: stream.isErr,
    request: stream.request,
    err: stream.err,
  };
}

// stop a stream at chunk n
export function limitStream(
  stream: MessageStream,
  itemLimit: number
): MessageStream {
  const [data, setData] = createSignal<StreamItem[]>(stream.data());
  const [isErr, setIsErr] = createSignal<boolean>(stream.isErr());
  const [isDone, setIsDone] = createSignal<boolean>(stream.isDone());

  createEffect(() => {
    const data = stream.data();
    if (data.length > itemLimit) return;
    setData(data);
    setIsErr(stream.isErr());
    setIsDone(stream.isDone());
  });

  return {
    close: stream.close,
    request: stream.request,
    data,
    isDone,
    isErr,
    err: () => undefined,
  };
}

export function blockDone(stream: MessageStream): MessageStream {
  return {
    isDone: () => false,
    close: stream.close,
    data: stream.data,
    isErr: stream.isErr,
    request: stream.request,
    err: stream.err,
  };
}

export function splitStream(
  stream: MessageStream,
  split: Splitter
): MessageStream {
  const [messages, setMessages] = createSignal<StreamItem[]>([]);

  createEffect(() => {
    const data = stream.data();
    const splitMessages = split(data);
    setMessages(splitMessages);
  });

  return {
    close: stream.close,
    data: messages,
    isDone: stream.isDone,
    isErr: stream.isErr,
    request: stream.request,
    err: stream.err,
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
): MessageStream {
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
