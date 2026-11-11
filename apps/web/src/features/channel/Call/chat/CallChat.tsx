import {
  ChannelInput,
  GUEST_INPUT_FEATURES,
  type InputHandle,
  type InputPersistenceKey,
  type InputSnapshot,
} from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { buildReplyTargetValue } from '@channel/Thread/utils/message-actions';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUserId } from '@core/context/user';
import { MessageThread, threadListItem } from '@core/messages/MessageThread';
import { MessageReferenceNavigation } from '@core/messages/message-reference-navigation';
import {
  MessageSenderNameProvider,
  type MessageTransport,
  MessageTransportProvider,
  MessageViewerProvider,
} from '@core/messages/message-transport';
import { fireAndForget } from '@core/util/fireAndForget';
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
import { CallChatBody } from './components/CallChatBody';
import { CallChatEmptyState } from './components/CallChatEmptyState';
import { useCallChat } from './queries/use-call-chat';
import { useGuestCallThread } from './queries/use-guest-call-thread';

type CallChatProps = {
  access:
    | { kind: 'member' }
    | { kind: 'guest'; session: { token: string; participantId: string } };
  callId: string;
  open: boolean;
  focusOnOpen?: boolean;
  onClose: () => void;
};

export default function CallChat(props: CallChatProps) {
  // Queries and all shared Markdown descendants stay within the chat boundary.
  return (
    <Suspense
      fallback={
        <CallChatBody open={props.open} composer={null}>
          <p role="status" class="text-sm text-ink-muted">
            Loading chat…
          </p>
        </CallChatBody>
      }
    >
      <Show
        when={props.access.kind === 'guest'}
        fallback={<MemberCallChat {...props} />}
      >
        <GuestCallChatContent {...props} />
      </Show>
    </Suspense>
  );
}

type ChatSource = Omit<ReturnType<typeof useCallChat>, 'refresh'> & {
  refresh: () => Promise<unknown>;
};
type ChatViewProps = Omit<CallChatProps, 'access'> & {
  chat: ChatSource & { denied?: () => boolean };
  sendMessage: (snapshot: InputSnapshot) => Promise<void>;
  persistenceKey?: InputPersistenceKey;
  guest?: boolean;
};

function MemberCallChat(props: CallChatProps) {
  const chat = useCallChat(() => props.callId);
  const send = useSendMessageMutation();
  const userId = useUserId();

  createEffect(
    on(
      () => props.open,
      (open, previous) => {
        if (open && previous === false) {
          fireAndForget(chat.refresh(), 'call-chat');
        }
      }
    )
  );

  async function sendMessage(snapshot: InputSnapshot) {
    const senderId = userId();
    if (!senderId || (!chat.thread() && !chat.empty())) {
      throw new Error('Call chat is not ready');
    }
    await send.mutateAsync({
      parent: chat.parent(),
      senderId,
      optimisticId: newMessageId(),
      ...buildPostMessageSendPayload({
        snapshot,
        threadId: chat.thread() ? props.callId : undefined,
      }),
    });
    await chat.refresh();
  }

  return (
    <CallChatView
      {...props}
      chat={chat}
      sendMessage={sendMessage}
      persistenceKey={`call-chat-${userId()}-${props.callId}-persist-v1`}
    />
  );
}

function GuestCallChatContent(props: CallChatProps) {
  if (props.access.kind !== 'guest') return null;
  const chat = useGuestCallThread(
    () => props.callId,
    () =>
      props.access.kind === 'guest'
        ? props.access.session
        : { token: '', participantId: '' },
    () => props.open
  );
  let pending: { id: string; content: string } | undefined;

  async function sendMessage(snapshot: InputSnapshot) {
    if (!chat.thread() && !chat.empty())
      throw new Error('Call chat is not ready');
    if (pending?.content !== snapshot.value) {
      pending = { id: newMessageId(), content: snapshot.value };
    }
    await chat.send(pending);
    pending = undefined;
  }

  const transport: MessageTransport = {
    patch: ({ id, content }) => chat.patch(id, content),
    remove: ({ id }) => chat.remove(id),
    react: ({ id, emoji, add }) => chat.react(id, emoji, add),
  };

  return (
    <MessageViewerProvider viewerId={chat.viewerId}>
      <MessageTransportProvider value={transport}>
        <CallChatView {...props} chat={chat} sendMessage={sendMessage} guest />
      </MessageTransportProvider>
    </MessageViewerProvider>
  );
}

function CallChatView(props: ChatViewProps) {
  const chat = props.chat;
  const [sendFailed, setSendFailed] = createSignal(false);
  const [input, setInput] = createSignal<InputHandle>();
  const [messageTarget, setMessageTarget] = createSignal<{
    id: string;
    requestKey: number;
  }>();
  const canSend = createMemo(() => !!chat.thread() || chat.empty());

  createEffect(
    on([() => props.open, canSend, input], ([open, ready, handle]) => {
      if (open && ready && props.focusOnOpen !== false) {
        handle?.focus({
          when: () => props.open && props.focusOnOpen !== false,
        });
      }
    })
  );

  async function sendMessage(snapshot: InputSnapshot) {
    setSendFailed(false);
    try {
      await props.sendMessage(snapshot);
    } catch (error) {
      setSendFailed(true);
      throw error;
    }
  }

  return (
    <MessageReferenceNavigation.Provider
      value={(target) => {
        if (target.parent.type !== 'call' || target.parent.id !== props.callId)
          return false;
        setMessageTarget((previous) => ({
          id: target.targetMessageId,
          requestKey: (previous?.requestKey ?? 0) + 1,
        }));
        return true;
      }}
    >
      <MessageSenderNameProvider
        resolve={(senderId) => {
          const thread = chat.thread();
          const message =
            thread &&
            [thread.root, ...thread.replies].find(
              (item) => item.sender_id === senderId
            );
          return props.guest
            ? (message?.imported_author?.name ??
                message?.guest_name ??
                undefined)
            : undefined;
        }}
      >
        <StaticMarkdownContext>
          <CallChatBody
            open={props.open}
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
                  persistenceKey={props.persistenceKey}
                  features={props.guest ? GUEST_INPUT_FEATURES : undefined}
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
              <CallChatEmptyState />
            </Show>
            <Show when={chat.failed()}>
              <p role="alert" class="text-sm text-ink-muted">
                {props.guest && chat.denied?.()
                  ? 'Chat is available while you are in this call.'
                  : 'Could not load chat.'}
              </p>
              <button
                type="button"
                class="mt-2 text-sm text-accent"
                onClick={() => fireAndForget(chat.refresh(), 'channel-call')}
              >
                Retry
              </button>
            </Show>
            <Show when={chat.thread()}>
              {(thread) => (
                <MessageThread
                  data={threadListItem(thread())}
                  replies={thread().replies}
                  canWrite
                  expanded
                  hideReplyInput
                  monorail
                  hideRail
                  targetId={messageTarget()?.id}
                  targetRequestKey={messageTarget()?.requestKey}
                  onClearTarget={() => setMessageTarget(undefined)}
                  onReply={({ message, selectedText, renderedText }) => {
                    const handle = input();
                    if (!handle) return;
                    const current = handle.snapshot();
                    handle.restoreSnapshot(
                      {
                        value: buildReplyTargetValue({
                          parent: chat.parent(),
                          message,
                          selectedText,
                          renderedText,
                          existingValue: current.value,
                        }),
                        mentions: current.mentions,
                        attachments: current.attachments,
                      },
                      { cursor: 'trailing-paragraph' }
                    );
                  }}
                  buildLink={(message) =>
                    buildCallMessageLink(props.callId, message.id)
                  }
                />
              )}
            </Show>
          </CallChatBody>
        </StaticMarkdownContext>
      </MessageSenderNameProvider>
    </MessageReferenceNavigation.Provider>
  );
}
