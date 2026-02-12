import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas';
import type { MessageStream } from '@service-cognition/websocket';
import { createSignal } from 'solid-js';
import {
  ChatInputProvider,
  ChatProvider,
  useChatContext,
} from '../../../context';
import { ChatMessages } from '../../message/ChatMessages';
import { StreamStatus } from './StreamStatus';

export function StreamDebuggerWithControls(props: {
  stream: () => MessageStream;
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
  stream: () => MessageStream;
  autoStart?: true;
}) {
  const chat = useChatContext();
  const [stream, setStream] = createSignal<MessageStream>();

  if (props.autoStart) {
    setStream(props.stream());
    chat.setStream(props.stream());
  }

  return (
    <div class="size-full flex flex-col gap-y-2">
      <div class="flex gap-x-1">
        <DeprecatedTextButton
          text="Stream"
          onClick={() => {
            const stream = props.stream();
            setStream(stream);
            chat.setStream(stream);
          }}
          theme="accent"
        />
        <DeprecatedTextButton
          text="Reset"
          theme="accent"
          onClick={() => {
            setStream(undefined);
            chat.setMessages([]);
            chat.setStream(undefined);
          }}
        />
      </div>
      <StreamStatus stream={stream} />
      <div data-chat-scroll class="min-h-0 max-h-[400px] overflow-y-auto">
        <ChatMessages />
      </div>
    </div>
  );
}

export function StreamDebugger(props: {
  stream: MessageStream;
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

function StreamDebuggerInner(props: { stream: MessageStream }) {
  const chat = useChatContext();
  chat.setStream(props.stream);
  return (
    <div
      data-chat-scroll
      class="size-full flex flex-col gap-y-2 overflow-y-auto"
    >
      <StreamStatus stream={() => props.stream} />
      <ChatMessages />
    </div>
  );
}
