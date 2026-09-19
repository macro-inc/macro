import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { MODEL_PRETTYNAME, MODEL_PROVIDER } from '@core/component/AI/constant';
import { Model } from '@core/component/AI/types';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import LockIcon from '@phosphor-icons/core/regular/lock-simple.svg?component-solid';

import { cognitionApiServiceClient } from '@service-cognition/client';
import type { ChatMessageStream } from '@service-connection/stream';
import { subscribe } from '@service-connection/stream';
import { Button, cn } from '@ui';
import { createEffect, createSignal, For, Show } from 'solid-js';
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
          <ProviderFailureChat />
          <FreeProviderFailureChat />
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
          <Button onClick={() => input.setIsGenerating(true)} variant="accent">
            Generate
          </Button>
          <Button onClick={() => input.setIsGenerating(false)} variant="accent">
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
      {/* Must be height-bounded (max-h + overflow): ChatMessages sizes a child
          to the scroll container's own height, so an unbounded container grows
          without limit (container height -> child min-height -> container ...). */}
      <div data-chat-scroll class="min-h-0 max-h-100 overflow-y-auto">
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

// --- Gallery-only multi-provider model set (NOT the product model list) ---
// A third provider (Cerebras) lets the gallery exercise multi-hop provider
// fallback. It deliberately lives here, not in model.ts, so it never surfaces
// in the real product model selector.
const CEREBRAS_MODEL = 'cerebras/llama-3.3-70b';
const GALLERY_MODELS: string[] = [...Object.values(Model), CEREBRAS_MODEL];

const galleryProvider = (id: string): string =>
  MODEL_PROVIDER[id as Model] ?? 'cerebras';
const galleryPrettyName = (id: string): string =>
  MODEL_PRETTYNAME[id as Model] ?? 'Cerebras Llama 3.3';

// Gallery copy of alternateProviderModel that also understands Cerebras: pick a
// candidate whose provider is neither the current one nor any that has failed.
function galleryAlternateModel(
  current: string,
  opts: { candidates: string[]; failedProviders: Set<string> }
): string | undefined {
  const excluded = new Set(opts.failedProviders);
  excluded.add(galleryProvider(current));
  return opts.candidates.find((id) => !excluded.has(galleryProvider(id)));
}

// Flat, always-visible model picker for the gallery: shows every gallery model
// with availability lock state (mirrors how the real selector dims + locks
// inaccessible models), so the free variant can show all models with only one
// available.
function GalleryModelSelector(props: {
  selected: string;
  isAvailable: (id: string) => boolean;
  onSelect: (id: string) => void;
  onLocked?: (id: string) => void;
}) {
  return (
    <div class="flex flex-wrap items-center gap-1.5 text-xs">
      <span class="text-ink-muted">Models:</span>
      <For each={GALLERY_MODELS}>
        {(id) => (
          <button
            type="button"
            class={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1',
              props.selected === id
                ? 'border-accent bg-accent text-ink'
                : 'border-edge text-ink-muted',
              !props.isAvailable(id) && 'opacity-50'
            )}
            onClick={() =>
              props.isAvailable(id) ? props.onSelect(id) : props.onLocked?.(id)
            }
          >
            {galleryPrettyName(id)}
            <Show when={!props.isAvailable(id)}>
              <LockIcon class="size-3" />
            </Show>
          </button>
        )}
      </For>
    </div>
  );
}

// A chat that always fails with a provider error, to exercise the
// provider-outage fallback UX end to end. Parameterized by which models the
// "user" can access so we can show both a paid variant (multi-provider
// fallback: Anthropic -> OpenAI -> Cerebras) and a free variant (no accessible
// alternate -> outage message).
function ProviderFailureDemo(props: {
  label: string;
  initialModel: string;
  availableModels: string[];
}) {
  return (
    <ChatInputProvider model={props.initialModel as Model}>
      <ProviderFailureDemoInner
        label={props.label}
        availableModels={props.availableModels}
      />
    </ChatInputProvider>
  );
}

function ProviderFailureDemoInner(props: {
  label: string;
  availableModels: string[];
}) {
  const input = useChatInputContext();

  // Remember which providers failed this session so we never bounce back to a
  // known-bad one — mirrors block-chat's Chat.tsx wiring.
  const failedProviders = new Set<string>();
  const nextModel = () =>
    galleryAlternateModel(input.model(), {
      // Only ever fall back to a model the "user" can access.
      candidates: props.availableModels,
      failedProviders,
    });
  const onSwitchModel = () => {
    const alt = nextModel();
    if (!alt) return;
    failedProviders.add(galleryProvider(input.model()));
    input.setModel(alt as Model);
  };

  return (
    <ChatProvider
      chatId={`debug-provider-failure-${props.availableModels.length}`}
      messages={[]}
      controllerOptions={{
        onSwitchModel,
        hasAlternateModel: () => nextModel() !== undefined,
        onShowPaywall: () => {},
      }}
    >
      <ProviderFailureDemoBody
        label={props.label}
        isAvailable={(id) => props.availableModels.includes(id)}
      />
    </ChatProvider>
  );
}

function ProviderFailureDemoBody(props: {
  label: string;
  isAvailable: (id: string) => boolean;
}) {
  const chat = useChatContext();
  const input = useChatInputContext();
  const [text, setText] = createSignal('Why did the AI provider fall over?');

  const send = () => {
    const content = text().trim();
    if (!content) return;
    // Optimistically show the user's message...
    chat.dispatch({
      type: 'send_started',
      optimisticMessage: {
        id: crypto.randomUUID(),
        content,
        role: 'user',
        attachments: [],
      },
    });
    // ...then simulate the provider erroring mid-stream. This drives the real
    // controller, which emits the actual error toast — the "Switch model"
    // button while an accessible alternate provider remains, or a "try again
    // later" outage message once none do.
    setTimeout(
      () =>
        chat.dispatch({ type: 'stream_error', streamError: 'provider_error' }),
      350
    );
  };

  return (
    <Item col label={props.label}>
      <GalleryModelSelector
        selected={input.model()}
        isAvailable={props.isAvailable}
        onSelect={(id) => input.setModel(id as Model)}
        onLocked={(id) => console.log('paywall for locked model', id)}
      />
      <div data-chat-scroll class="min-h-0 max-h-72 w-full overflow-y-auto">
        <ChatMessages />
      </div>
      <div class="flex w-full gap-2">
        <input
          class="flex-1 rounded border border-accent px-2 py-1 text-sm"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder="Type a message and send"
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <Button variant="accent" onClick={send}>
          Send
        </Button>
      </div>
    </Item>
  );
}

// Paid: every provider (incl. Cerebras) is available, so the fallback chains
// Anthropic -> OpenAI -> Cerebras before running out and showing the outage
// message.
function ProviderFailureChat() {
  return (
    <ProviderFailureDemo
      label="Provider failure - switch-model fallback"
      initialModel={Model.opus5}
      availableModels={GALLERY_MODELS}
    />
  );
}

// Free: all models are shown but only Haiku is available, so there is no
// accessible model on another provider — the first failure already shows the
// outage message (no switch button).
function FreeProviderFailureChat() {
  return (
    <ProviderFailureDemo
      label="Provider failure (free) - all shown, only Haiku available"
      initialModel={Model.haiku45}
      availableModels={[Model.haiku45]}
    />
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
            name: 'ContentSearch',
            data: {
              query: 'most important headlines today',
            },
          },
        },
        {
          type: 'toolResponse',
          tool: {
            name: 'ContentSearch',
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
        <Button onClick={startStream} variant="accent">
          Stream
        </Button>
        <Button onClick={() => setIsPaused((p) => !p)} variant="accent">
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
          variant="accent"
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
