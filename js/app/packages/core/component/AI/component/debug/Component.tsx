import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { DEFAULT_MODEL } from '@core/component/AI/constant';
import type { ChatMessageStream, Model } from '@core/component/AI/types';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { MessageStream } from '@service-cognition/websocket';
import { subscribe } from '@service-connection/stream';
import { createEffect, createSignal } from 'solid-js';
import {
  ChatInputProvider,
  ChatProvider,
  useChatContext,
  useChatInputContext,
} from '../../context';
import { useAttachments } from '../../signal/attachment';
import { pausableStream } from '../../util/stream';
import { ChatInput } from '../input/ChatInput';
import { ModelSelector } from '../input/ModelSelector';
import { useChatMarkdownArea } from '../input/useChatMarkdownArea';
import { ChatMessages } from '../message/ChatMessages';

function toChat(stream: MessageStream): ChatMessageStream {
  return {
    data: stream.data,
    isDone: stream.isDone,
    model: DEFAULT_MODEL,
    attachments: [],
    streamId: stream.request.stream_id,
  };
}

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
    <div class="h-full w-full overflow-auto py-2">
      <div class="flex flex-1 justify-center w-full ">
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
  const attachments = useAttachments();
  const { MarkdownArea, ref } = useChatMarkdownArea({
    addAttachment: attachments.addAttachment,
  });
  createEffect(() => {
    const el = ref();
    if (el) {
      el.classList.add('bg-accent/10');
    }
  });

  return (
    <Item label="chat markown area">
      <MarkdownArea />
    </Item>
  );
}

function ChatModelSelector() {
  const [model, setModel] = createSignal<Model>();

  return (
    <Item label={'model selector'}>
      <div class="w-full p-4 items-center gap-4 ">
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
  const chatMarkdownArea = useChatMarkdownArea({
    addAttachment: (a) => input.attachments.addAttachment(a),
  });

  return (
    <Item label="Chat input - not connected to backend">
      <div class="w-full h-full">
        <div class="flex gap-2 py-2">
          <DeprecatedTextButton
            onClick={() => input.setIsGenerating(true)}
            theme="accent"
            text="Generate"
          />
          <DeprecatedTextButton
            onClick={() => input.setIsGenerating(false)}
            theme="accent"
            text="Stop"
          />
        </div>
        <ChatInput
          markdown={chatMarkdownArea}
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
  const input = useChatInputContext();
  const chatMarkdownArea = useChatMarkdownArea({
    addAttachment: (a) => input.attachments.addAttachment(a),
  });

  const [_gen, setGen] = createSignal(false);
  const onSend = async (input: ChatSendInput) => {
    const response = await cognitionApiServiceClient.sendStreamChatMessage({
      content: input.content,
      model: input.model,
      attachments: input.attachments.length > 0 ? input.attachments : undefined,
      toolset: input.toolset,
    });
    if (isErr(response)) {
      console.log('error sending message', response);
      return;
    }
    const [, { stream_id, chat_id }] = response;
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
      <div class="w-full h-full">
        <ChatInput markdown={chatMarkdownArea} onSend={onSend} />
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
  const [stream, setStream] = createSignal<MessageStream>();
  const makeStream = () => delayStream(poem(), slowFirst);

  return (
    <Item col label="Chat messages - mock stream">
      <button
        class={`bg-accent text-ink} px-2 rounded-xs outline outline-ink `}
        onClick={() => {
          const poemStream = makeStream();
          setStream(poemStream);
          chat.setStream(toChat(poemStream));
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
          <div data-chat-scroll class="min-h-0 max-h-[400px] overflow-y-auto">
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
  const input = useChatInputContext();
  const chat = useChatContext();
  const chatMarkdownArea = useChatMarkdownArea({
    addAttachment: (a) => input.attachments.addAttachment(a),
  });
  const [_isGen, setIsGen] = createSignal(false);
  const [debugStream, _setDebugStream] = createSignal<MessageStream>();

  const onSend = async (input: ChatSendInput) => {
    chat.addMessage({
      attachments: input.attachments,
      content: input.content,
      role: 'user',
      id: '',
    });
    const response = await cognitionApiServiceClient.sendStreamChatMessage({
      content: input.content,
      model: input.model,
      chat_id: chat.chatId(),
      attachments: input.attachments.length > 0 ? input.attachments : undefined,
      toolset: input.toolset,
    });
    if (isErr(response)) {
      console.log('error sending message', response);
      return;
    }
    const [, { stream_id, chat_id }] = response;
    const connectionStream = subscribe('chat', chat_id, stream_id);
    if (!connectionStream) {
      console.log('no connection stream');
      return;
    }
    const chatStream: ChatMessageStream = {
      data: connectionStream.data,
      isDone: connectionStream.isDone,
      model: input.model,
      attachments: input.attachments,
      streamId: stream_id,
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
      <div
        data-chat-scroll
        class="size-full min-h-0 max-h-[400px] overflow-y-auto"
      >
        <StreamStatus stream={debugStream} />
        <ChatMessages />
        <ChatInput
          markdown={chatMarkdownArea}
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

function ToolCallRenderInner(props: { stream: MessageStream }) {
  const chat = useChatContext();
  chat.setStream(toChat(props.stream));

  return (
    <Item label="Tool call - static">
      <div
        data-chat-scroll
        class="size-full flex space-y-1 flex-col overflow-y-auto max-h-[400px]"
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
      <div class="max-h-[400px] overflow-y-auto">
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
  const [stream, setStream] = createSignal<MessageStream>();
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
    chat.setStream(toChat(controlled));
  };

  return (
    <Item col label="Table stream with controls">
      <div class="flex gap-x-2 items-center">
        <DeprecatedTextButton
          text="Stream"
          onClick={startStream}
          theme="accent"
        />
        <DeprecatedTextButton
          text={isPaused() ? 'Resume' : 'Pause'}
          onClick={() => setIsPaused((p) => !p)}
          theme="accent"
        />
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
        <DeprecatedTextButton
          text="Reset"
          theme="accent"
          onClick={() => {
            setStream(undefined);
            setRawText('');
            chat.setMessages([]);
            chat.setStream(undefined);
          }}
        />
      </div>
      <StreamStatus stream={stream} />
      {showRaw() ? (
        <div class="min-h-0 max-h-[400px] overflow-y-auto select-text">
          <pre class="text-xs whitespace-pre-wrap font-mono break-all select-text cursor-text">
            {rawText()}
          </pre>
        </div>
      ) : (
        <div data-chat-scroll class="min-h-0 max-h-[400px] overflow-y-auto">
          <ChatMessages />
        </div>
      )}
    </Item>
  );
}
