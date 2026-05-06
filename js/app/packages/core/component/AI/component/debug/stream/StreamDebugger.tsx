import { Button } from '@ui/components/Button';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas';
import type { ChatMessageStream } from '@service-connection/stream';
import { createSignal } from 'solid-js';
import {
  ChatInputProvider,
  ChatProvider,
  useChatContext,
} from '../../../context';
import { ChatMessages } from '../../message/ChatMessages';
import { StreamStatus } from './StreamStatus';

export function StreamDebuggerWithControls(props: {
  stream: () => ChatMessageStream;
  messages?: ChatMessageWithAttachments[];
  autoStart?: true;
}) {
  return (
    <ChatInputProvider>
      <ChatProvider chatId="debug" messages={props.messages ?? []}>
        <StreamDebuggerWithControlsInner
          stream={props.stream}
          autoStart={props.autoStart}
        />
      </ChatProvider>
    </ChatInputProvider>
  );
}

function StreamDebuggerWithControlsInner(props: {
  stream: () => ChatMessageStream;
  autoStart?: true;
}) {
  const chat = useChatContext();
  const [stream, setStream] = createSignal<ChatMessageStream>();

  if (props.autoStart) {
    const s = props.stream();
    setStream(s);
    chat.setStream(s);
  }

  return (
    <div class="size-full flex flex-col gap-y-2">
      <div class="flex gap-x-1">
        <Button
          onClick={() => {
            const stream = props.stream();
            setStream(stream);
            chat.setStream(stream);
          }}
          variant="active"
        >
          Stream
        </Button>
        <Button
          variant="active"
          onClick={() => {
            setStream(undefined);
            chat.setMessages([]);
            chat.setStream(undefined);
          }}
        >
          Reset
        </Button>
      </div>
      <StreamStatus stream={stream} />
      <div data-chat-scroll class="min-h-0 max-h-[400px] overflow-y-auto">
        <ChatMessages />
      </div>
    </div>
  );
}

export function StreamDebugger(props: {
  stream: ChatMessageStream;
  messages?: ChatMessageWithAttachments[];
}) {
  return (
    <ChatInputProvider>
      <ChatProvider chatId="debug" messages={props.messages ?? []}>
        <StreamDebuggerInner stream={props.stream} />
      </ChatProvider>
    </ChatInputProvider>
  );
}

function StreamDebuggerInner(props: { stream: ChatMessageStream }) {
  const chat = useChatContext();
  chat.setStream(props.stream);
  return (
    <div
      data-chat-scroll
      class="size-full flex flex-col gap-y-2 overflow-y-auto"
    >
      <div class="p-2 bg-menu border border-edge text-ink font-mono text-sm">
        <span>chunks: {props.stream.data().length}</span>
        {' | '}
        <span>isDone: {String(props.stream.isDone())}</span>
      </div>
      <ChatMessages />
    </div>
  );
}
