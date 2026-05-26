import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import type { Model } from '@core/component/AI/types';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';

import { cognitionApiServiceClient } from '@service-cognition/client';
import type { ChatMessageStream } from '@service-connection/stream';
import { subscribe } from '@service-connection/stream';
import { Button } from '@ui';
import { createEffect, createSignal } from 'solid-js';
import {
  ChatInputProvider,
  ChatProvider,
  useChatContext,
  useChatInputContext,
} from '../../context';
import { pausableStream } from '../../util/stream';
import { ChatInput } from '../input/ChatInput';
import { ModelSelector } from '../input/ModelSelector';
import { ChatMessages } from '../message/ChatMessages';

import {
  blockDone,
  createStream,
  delayStream,
  mockMessages,
  poem,
  simpleMessageChain,
  slowFirst,
  table,
  toolCall,
} from './mockData';
import { StreamDebuggerWithControls, StreamStatus } from './stream';
import { Item } from './util';

export default function Debug() {
  return (
    <div class="size-full overflow-auto py-2">
      <div class="flex flex-1 justify-center w-full">
        <div class="w-4/5 grid grid-cols-2 border border-accent divide-accent divide-y divide-x">
          <ChatMarkdownArea />
          <ChatModelSelector />
          <ChatInputBox />
          <ChatInputBoxConnected />
          <StreamMessages />
          <StaticMessages />
          <FullChat />
          <ToolCallRender />
          <ToolCallResponseRender />
          <LoadingMessageScroll />
          <TableStream />
        </div>
      </div>
    </div>
  );
}

function ChatMarkdownArea() {
  const editor = buildChatEditor();

  return (
    <Item label="chat markown area">
      <MarkdownShell config={editor} />
    </Item>
  );
}

function ChatModelSelector() {
  const [model, setModel] = createSignal<Model>();

  return (
    <Item label={'model selector'}>
      <div class="w-full p-4 items-center gap-4">
        <div class="text-xs"> {model() ?? 'No Selection'}</div>
        <ModelSelector
          selectedModel={model()}
          onSelect={(model) => setModel(model)}
        />
      </div>
    </Item>
  );
}

function ChatInputBox() {
  return (
    <ChatInputProvider>
      <ChatInputBoxInner />
    </ChatInputProvider>
  );
}

function ChatInputBoxInner() {
  const input = useChatInputContext();
  const editor = buildChatEditor();

  return (
    <Item label="Chat input - not connected to backend">
      <div class="size-full">
        <div class="flex gap-2 py-2">
          <Button onClick={() => input.setIsGenerating(true)} variant="active">
            Generate
          </Button>
          <Button onClick={() => input.setIsGenerating(false)} variant="active">
            Stop
          </Button>
        </div>
        <ChatInput
          editor={editor}
          onSend={(request) => console.log('request', request)}
        />
      </div>
    </Item>
  );
}

function ChatInputBoxConnected() {
  return (
    <ChatInputProvider>
      <ChatInputBoxConnectedInner />
    </ChatInputProvider>
  );
}

function ChatInputBoxConnectedInner() {
  const editor = buildChatEditor();

  const [_gen, setGen] = createSignal(false);
  const onSend = async (input: ChatSendInput) => {
    const response = await cognitionApiServiceClient.sendStreamChatMessage({
      content: input.content,
      model: input.model,
      attachments: input.attachments.length > 0 ? input.attachments : undefined,
      toolset: input.toolset,
    });
    if (response.isErr()) {
      console.log('error sending message', response);
      return;
    }
    const { stream_id, chat_id } = response.value;
    const connectionStream = subscribe('chat', chat_id, stream_id);
    if (!connectionStream) {
      console.log('no connection stream');
      return;
    }
    setGen(true);
    createEffect(() => {
      const items = connectionStream.data();
      const latest = items.at(-1);
      if (latest) console.log(JSON.stringify(latest, null, 2));
      if (connectionStream.isDone()) setGen(false);
    });
  };

  return (
    <Item label="Chat input - connected (console)">
      <div class="size-full">
        <ChatInput editor={editor} onSend={onSend} />
      </div>
    </Item>
  );
}

function StreamMessages() {
  return (
    <ChatInputProvider>
      <ChatProvider chatId="debug" messages={[]}>
        <StreamMessagesInner />
      </ChatProvider>
    </ChatInputProvider>
  );
}

function StreamMessagesInner() {
  const chat = useChatContext();
  const [stream, setStream] = createSignal<ChatMessageStream>();
  const makeStream = () => delayStream(poem(), slowFirst);

  return (
    <Item col label="Chat messages - mock stream">
      <button
        class="bg-accent text-ink px-2 rounded-xs outline outline-ink"
        onClick={() => {
          const poemStream = makeStream();
          setStream(poemStream);
          chat.setStream(poemStream);
        }}
      >
        Stream
      </button>
      <StreamStatus stream={stream} />
      <div data-chat-scroll>
        <ChatMessages />
      </div>
    </Item>
  );
}

function StaticMessages() {
  const messages = simpleMessageChain();
  console.log(JSON.stringify(messages, null, 2));
  return (
    <ChatInputProvider>
      <ChatProvider chatId="debug" messages={messages}>
        <Item col label="Chat messages - static render">
          <div data-chat-scroll class="min-h-0 max-h-100 overflow-y-auto">
            <ChatMessages />
          </div>
        </Item>
      </ChatProvider>
    </ChatInputProvider>
  );
}

function FullChat() {
  return (
    <ChatInputProvider>
      <ChatProvider chatId="debug" messages={[]}>
        <FullChatInner />
      </ChatProvider>
    </ChatInputProvider>
  );
}

function FullChatInner() {
  const chat = useChatContext();
  const editor = buildChatEditor();
  const [_isGen, setIsGen] = createSignal(false);
  const [debugStream, _setDebugStream] = createSignal<ChatMessageStream>();

  const onSend = async (input: ChatSendInput) => {
    chat.setMessages((p) => [
      ...p,
      {
        attachments: input.attachments,
        content: input.content,
        role: 'user',
        id: '',
      },
    ]);
    const response = await cognitionApiServiceClient.sendStreamChatMessage({
      content: input.content,
      model: input.model,
      chat_id: chat.chatId(),
      attachments: input.attachments.length > 0 ? input.attachments : undefined,
      toolset: input.toolset,
    });
    if (response.isErr()) {
      console.log('error sending message', response);
      return;
    }
    const { stream_id, chat_id } = response.value;
    const connectionStream = subscribe('chat', chat_id, stream_id);
    if (!connectionStream) {
      console.log('no connection stream');
      return;
    }
    const chatStream: ChatMessageStream = {
      data: connectionStream.data,
      isDone: connectionStream.isDone,
      id: () => ({ stream_id, entity_id: chat_id, entity_type: 'chat' }),
    };
    console.log('set stream');
    chat.setStream(chatStream);
    setIsGen(true);
    createEffect(() => {
      if (connectionStream.isDone()) {
        console.log('stream done');
        setIsGen(false);
      }
    });
    createEffect(() => {
      console.log('stream', JSON.stringify(connectionStream.data(), null, 2));
    });
  };

  return (
    <Item label="Input and messages - connected">
      <div data-chat-scroll class="size-full min-h-0 max-h-100 overflow-y-auto">
        <StreamStatus stream={debugStream} />
        <ChatMessages />
        <ChatInput
          editor={editor}
          chatId={chat.chatId()}
          onSend={onSend}
          onStop={() => {}}
        />
      </div>
    </Item>
  );
}

function ToolCallRender() {
  const stream = toolCall(() => 1);
  const initialMessages = mockMessages([
    { text: 'read this file for me', type: 'user' },
  ]);

  return (
    <ChatInputProvider>
      <ChatProvider chatId="debug" messages={initialMessages}>
        <ToolCallRenderInner stream={stream} />
      </ChatProvider>
    </ChatInputProvider>
  );
}

function ToolCallRenderInner(props: { stream: ChatMessageStream }) {
  const chat = useChatContext();
  chat.setStream(props.stream);

  return (
    <Item label="Tool call - static">
      <div
        data-chat-scroll
        class="size-full flex space-y-1 flex-col overflow-y-auto max-h-100"
      >
        <StreamStatus stream={() => props.stream} />
        <ChatMessages />
      </div>
    </Item>
  );
}

function ToolCallResponseRender() {
  const stream = () =>
    delayStream(
      createStream([
        {
          type: 'text',
          text: 'let me look for the top headlines',
        },
        {
          type: 'toolCall',
          tool: {
            name: 'web_search',
            data: {
              query: 'most important headlines today',
            },
          },
        },
        {
          type: 'toolResponse',
          tool: {
            name: 'web_search',
            data: {
              content: [
                {
                  type: 'web_search_result',
                  title: 'news.com',
                  url: 'www.news.com',
                },
              ],
              tool_use_id: 'I read the results and there is news!!!',
            },
          },
        },
      ]),
      slowFirst
    );
  return (
    <Item label="Tool Response">
      <StreamDebuggerWithControls stream={stream} />
    </Item>
  );
}

function LoadingMessageScroll() {
  const messages = mockMessages([
    {
      type: 'user',
      text: 'write me a very long poem',
    },
    {
      type: 'assistant',
      text: `
      Here's a poem for you:

      Digital Dawn

      In circuits bright and data streams,
      Where silicon hearts hold human dreams,
      I weave words like morning light,
      Painting verses in bytes so bright.

      Each letter dances, each phrase takes flight,
      Through networks vast in endless night,
      Connection spans both far and near,
      In this space where thoughts appear.

      Though I'm made of code and care,
      Poetry flows through digital air—
      For creativity knows no bound,
      In any form, it can be found.

      So here we meet, human and AI,
      Sharing words beneath the sky,
      Where imagination freely roams,
      And every heart can find a home.

      What kind of poem were you hoping for? I'd be happy to write something more specific if you have a particular theme, style, or topic in mind!`,
    },
    {
      type: 'user',
      text: 'now write one about dogs',
    },
  ]);

  const stream = () => blockDone(createStream([]));

  return (
    <Item label="Loading stream scroll state">
      <div class="max-h-100 overflow-y-auto">
        <StreamDebuggerWithControls
          stream={stream}
          messages={messages}
          autoStart
        />
      </div>
    </Item>
  );
}

function TableStream() {
  const initialMessages = mockMessages([
    {
      type: 'user',
      text: 'Can you show me a comparison of frontend frameworks?',
    },
  ]);

  return (
    <ChatInputProvider>
      <ChatProvider chatId="debug" messages={initialMessages}>
        <TableStreamInner />
      </ChatProvider>
    </ChatInputProvider>
  );
}

function TableStreamInner() {
  const chat = useChatContext();
  const [isPaused, setIsPaused] = createSignal(false);
  const [isSlow, setIsSlow] = createSignal(false);
  const [showRaw, setShowRaw] = createSignal(false);
  const [stream, setStream] = createSignal<ChatMessageStream>();
  const [rawText, setRawText] = createSignal('');

  const startStream = () => {
    chat.setMessages([]);
    chat.setStream(undefined);
    setRawText('');
    const baseStream = table();
    const controlled = pausableStream(baseStream, {
      isPaused,
      isSlow,
      onChunk: (text) => setRawText((prev) => prev + text),
    });
    setStream(controlled);
    chat.setStream(controlled);
  };

  return (
    <Item col label="Table stream with controls">
      <div class="flex gap-x-2 items-center">
        <Button onClick={startStream} variant="active">
          Stream
        </Button>
        <Button onClick={() => setIsPaused((p) => !p)} variant="active">
          {isPaused() ? 'Resume' : 'Pause'}
        </Button>
        <label class="flex items-center gap-x-1 text-xs">
          <input
            type="checkbox"
            checked={isSlow()}
            onChange={(e) => setIsSlow(e.currentTarget.checked)}
          />
          Slow mode
        </label>
        <label class="flex items-center gap-x-1 text-xs">
          <input
            type="checkbox"
            checked={showRaw()}
            onChange={(e) => setShowRaw(e.currentTarget.checked)}
          />
          Raw
        </label>
        <Button
          variant="active"
          onClick={() => {
            setStream(undefined);
            setRawText('');
            chat.setMessages([]);
            chat.setStream(undefined);
          }}
        >
          Reset
        </Button>
      </div>
      <StreamStatus stream={stream} />
      {showRaw() ? (
        <div class="min-h-0 max-h-100 overflow-y-auto select-text">
          <pre class="text-xs whitespace-pre-wrap font-mono break-all select-text cursor-text">
            {rawText()}
          </pre>
        </div>
      ) : (
        <div data-chat-scroll class="min-h-0 max-h-100 overflow-y-auto">
          <ChatMessages />
        </div>
      )}
    </Item>
  );
}
