import {
  ChannelInput,
  type InputHandle,
  type InputSnapshot,
} from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUserId } from '@core/context/user';
import { MessageThread, threadListItem } from '@core/messages/MessageThread';
import {
  newMessageId,
  useSendMessageMutation,
} from '@queries/messages/mutations';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
  Suspense,
} from 'solid-js';
import { buildCallMessageLink } from './build-call-message-link';
import { CallChatPanel } from './components/CallChatPanel';
import { useCallChat } from './queries/use-call-chat';

export default function CallChat(props: {
  callId: string;
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  // Queries and all shared Markdown descendants stay within the chat boundary.
  return (
    <Suspense
      fallback={
        <CallChatPanel {...props} composer={null}>
          <p role="status" class="text-sm text-ink-muted">
            Loading chat…
          </p>
        </CallChatPanel>
      }
    >
      <CallChatContent {...props} />
    </Suspense>
  );
}

function CallChatContent(props: {
  callId: string;
  id: string;
  open: boolean;
  onClose: () => void;
}) {
  const chat = useCallChat(() => props.callId);
  const send = useSendMessageMutation();
  const userId = useUserId();
  const [sendFailed, setSendFailed] = createSignal(false);
  const [input, setInput] = createSignal<InputHandle>();
  const canSend = createMemo(() => !!chat.thread() || chat.empty());

  createEffect(
    on([() => props.open, canSend, input], ([open, ready, handle]) => {
      if (open && ready) handle?.focus();
    })
  );

  async function sendMessage(snapshot: InputSnapshot) {
    const senderId = userId();
    if (!senderId || (!chat.thread() && !chat.empty())) {
      throw new Error('Call chat is not ready');
    }
    setSendFailed(false);
    try {
      await send.mutateAsync({
        parent: chat.parent(),
        senderId,
        optimisticId: newMessageId(),
        ...buildPostMessageSendPayload({
          snapshot,
          threadId: chat.thread() ? props.callId : undefined,
        }),
      });
    } catch (error) {
      setSendFailed(true);
      throw error;
    }
    await chat.refresh();
  }

  return (
    <StaticMarkdownContext>
      <CallChatPanel
        id={props.id}
        open={props.open}
        onClose={props.onClose}
        composer={
          <div inert={!canSend()} classList={{ 'opacity-50': !canSend() }}>
            <Show when={sendFailed()}>
              <p role="alert" class="mb-2 text-xs text-failure">
                Message could not be sent. Try again.
              </p>
            </Show>
            <ChannelInput
              parent={chat.parent()}
              input={{ mode: 'channel', placeholder: 'Message this call…' }}
              persistenceKey={`call-chat-${userId()}-${props.callId}-persist-v1`}
              autofocus={false}
              onReady={setInput}
              onSend={sendMessage}
              onSendError={() => setSendFailed(true)}
              onEscape={props.onClose}
            />
          </div>
        }
      >
        <Show when={chat.loading()}>
          <p role="status" class="text-sm text-ink-muted">
            Loading chat…
          </p>
        </Show>
        <Show when={chat.empty()}>
          <p class="px-1 text-sm text-ink-muted">
            Start the conversation. Messages stay with this call.
          </p>
        </Show>
        <Show when={chat.failed()}>
          <p role="alert" class="text-sm text-ink-muted">
            Could not load chat.
          </p>
          <button
            type="button"
            class="mt-2 text-sm text-accent"
            onClick={() => void chat.refresh()}
          >
            Retry
          </button>
        </Show>
        <Show when={chat.thread()}>
          {(thread) => (
            <MessageThread
              data={threadListItem(thread())}
              canWrite
              expanded
              hideReplyInput
              monorail
              buildLink={(message) =>
                buildCallMessageLink(props.callId, message.id)
              }
            />
          )}
        </Show>
      </CallChatPanel>
    </StaticMarkdownContext>
  );
}
