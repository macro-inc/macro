import type {
  CreateAndSend,
  MessageStream,
  Model,
  Send,
} from '@core/component/AI/types';
import { TextButton } from '@core/component/TextButton';
import { createEffect, createSignal } from 'solid-js';
import { useAttachments } from '../../signal/attachment';
import { createStream } from '../../util/stream';
import { ModelSelector } from '../input/ModelSelector';
import { useChatInput } from '../input/useChatInput';
import { useChatMarkdownArea } from '../input/useChatMarkdownArea';
import { useChatMessages } from '../message/ChatMessages';
import {
  blockDone,
  delayStream,
  mockMessages,
  poem,
  simpleMessageChain,
  slowFirst,
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
  const { ChatInput, setIsGenerating: setGen } = useChatInput();

  return (
    <Item label="Chat input - not connected to backend">
      <div class="w-full h-full">
        <div class="flex gap-2 py-2">
          <TextButton
            onClick={() => setGen(true)}
            theme="accent"
            text="Generate"
          />
          <TextButton
            onClick={() => setGen(false)}
            theme="accent"
            text="Stop"
          />
        </div>
        <ChatInput onSend={(request) => console.log('request', request)} />
      </div>
    </Item>
  );
}

function ChatInputBoxConnected() {
  const [_gen, setGen] = createSignal(false);
  const onSend = async (request: Send | CreateAndSend) => {
    if (request.type === 'createAndSend') {
      const response = await request.call();
      if ('type' in response && response.type === 'error') {
        console.log('error creating chat', response);
        return;
      } else {
        console.log('created chat ', response.chat_id);
        return onSend(response);
      }
    } else {
      const stream = request.call();
      setGen(true);
      createEffect(() => {
        const items = stream.data();
        const latest = items.at(-1);
        if (latest) console.log(JSON.stringify(latest, null, 2));
        if (stream.isDone()) setGen(false);
      });
    }
  };

  const { ChatInput } = useChatInput();

  return (
    <Item label="Chat input - connected (console)">
      <div class="w-full h-full">
        <ChatInput onSend={onSend} />
      </div>
    </Item>
  );
}

function StreamMessages() {
  const { ChatMessages, setStream: setMessageStream } = useChatMessages({
    messages: [],
  });
  const [stream, setStream] = createSignal<MessageStream>();
  const makeStream = () => delayStream(poem(), slowFirst);

  return (
    <Item col label="Chat messages - mock stream">
      <button
        class={`bg-accent text-ink} px-2 rounded-xs outline outline-ink `}
        onClick={() => {
          const poemStream = makeStream();
          setStream(poemStream);
          setMessageStream(poemStream);
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
  const { ChatMessages } = useChatMessages({ messages: messages });
  console.log(JSON.stringify(messages, null, 2));
  return (
    <Item col label="Chat messages - static render">
      <div data-chat-scroll class="min-h-0 max-h-[400px] overflow-y-auto">
        <ChatMessages />
      </div>
    </Item>
  );
}

function FullChat() {
  const [_isGen, setIsGen] = createSignal(false);
  const [stream, setDebugStream] = createSignal<MessageStream>();
  const { ChatMessages, addMessage, setStream } = useChatMessages({
    messages: [],
  });

  const onSend = async (request: Send | CreateAndSend) => {
    if (request.type === 'createAndSend') {
      const response = await request.call();
      if ('type' in response && response.type === 'error') {
        console.log('error creating chat', response);
        return;
      } else {
        console.log('created chat ', response.chat_id);
        return onSend(response);
      }
    } else {
      addMessage({
        attachments: request.request.attachments ?? [],
        content: request.request.content,
        role: 'user',
        id: '',
      });
      const stream = request.call();
      console.log('set stream');
      setStream(stream);
      setDebugStream(stream);
      setIsGen(true);
      createEffect(() => {
        if (stream.isErr()) {
          console.log('stream error');
        }
        if (stream.isDone()) {
          console.log('stream done');
          setIsGen(false);
        }
      });
      createEffect(() => {
        console.log('stream', JSON.stringify(stream.data(), null, 2));
      });
    }
  };

  const { ChatInput } = useChatInput();

  return (
    <Item label="Input and messages - connected">
      <div
        data-chat-scroll
        class="size-full min-h-0 max-h-[400px] overflow-y-auto"
      >
        <StreamStatus stream={stream} />
        <ChatMessages />
        <ChatInput onSend={onSend} onStop={() => {}} />
      </div>
    </Item>
  );
}

function ToolCallRender() {
  const stream = toolCall(() => 1);

  const { ChatMessages, setStream } = useChatMessages({
    messages: mockMessages([
      {
        text: 'read this file for me',
        type: 'user',
      },
    ]),
  });

  setStream(stream);
  return (
    <Item label="Tool call - static">
      <div
        data-chat-scroll
        class="size-full flex space-y-1 flex-col overflow-y-auto max-h-[400px]"
      >
        <StreamStatus stream={() => stream} />
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
            name: 'WebSearch',
            data: {
              query: 'most important headlines today',
            },
          },
        },
        {
          type: 'toolResponse',
          tool: {
            name: 'WebSearch',
            data: {
              results: [{ name: 'news.com', url: 'www.news.com' }],
              content: 'I read the results and there is news!!!',
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
