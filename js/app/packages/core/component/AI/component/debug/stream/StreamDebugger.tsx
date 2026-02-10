import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas';
import type { MessageStream } from '@service-cognition/websocket';
import { createSignal } from 'solid-js';
import { ChatContextProvider, useChatContext } from '../../../context';
import { ChatMessages } from '../../message/ChatMessages';
import { StreamStatus } from './StreamStatus';

export function StreamDebuggerWithControls(props: {
  stream: () => MessageStream;
  messages?: ChatMessageWithAttachments[];
  autoStart?: true;
}) {
  return (
    <ChatContextProvider messages={props.messages ?? []}>
      <StreamDebuggerWithControlsInner
        stream={props.stream}
        autoStart={props.autoStart}
      />
    </ChatContextProvider>
  );
}

function StreamDebuggerWithControlsInner(props: {
  stream: () => MessageStream;
  autoStart?: true;
}) {
  const ctx = useChatContext();
  const [stream, setStream] = createSignal<MessageStream>();

  if (props.autoStart) {
    setStream(props.stream());
    ctx.setStream!(props.stream());
  }

  return (
    <div class="size-full flex flex-col gap-y-2">
      <div class="flex gap-x-1">
        <DeprecatedTextButton
          text="Stream"
          onClick={() => {
            const stream = props.stream();
            setStream(stream);
            ctx.setStream!(stream);
          }}
          theme="accent"
        />
        <DeprecatedTextButton
          text="Reset"
          theme="accent"
          onClick={() => {
            setStream(undefined);
            ctx.setMessages!([]);
            ctx.setStream!(undefined);
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
    <ChatContextProvider messages={props.messages ?? []}>
      <StreamDebuggerInner stream={props.stream} />
    </ChatContextProvider>
  );
}

function StreamDebuggerInner(props: { stream: MessageStream }) {
  const ctx = useChatContext();
  ctx.setStream!(props.stream);
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
