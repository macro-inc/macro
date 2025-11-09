import { TextButton } from '@core/component/TextButton';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas';
import type { MessageStream } from '@service-cognition/websocket';
import { createSignal } from 'solid-js';
import { useChatMessages } from '../../message';
import { StreamStatus } from './StreamStatus';

export function StreamDebuggerWithControls(props: {
  stream: () => MessageStream;
  messages?: ChatMessageWithAttachments[];
  autoStart?: true;
}) {
  const [stream, setStream] = createSignal<MessageStream>();
  const {
    ChatMessages,
    setStream: setMessageStream,
    reset,
  } = useChatMessages({
    messages: props.messages ?? [],
  });

  if (props.autoStart) {
    setStream(props.stream());
    setMessageStream(props.stream());
  }

  return (
    <div class="size-full flex flex-col gap-y-2">
      <div class="flex gap-x-1">
        <TextButton
          text="Stream"
          onClick={() => {
            const stream = props.stream();
            setStream(stream);
            setMessageStream(stream);
          }}
          theme="accent"
        />
        <TextButton
          text="Reset"
          theme="accent"
          onClick={() => {
            setStream(undefined);
            reset();
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
  const { ChatMessages, setStream: setMessageStream } = useChatMessages({
    messages: props.messages ?? [],
  });

  setMessageStream(props.stream);
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
