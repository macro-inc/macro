import type {
  ChatMessageWithAttachments,
  MessageStream,
} from '@core/component/AI/types';
import { asChatMessage } from '@core/component/AI/util/message';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { toast } from '@core/component/Toast/Toast';
import { createElementSize } from '@solid-primitives/resize-observer';
import type { Accessor, JSXElement, Setter } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { handleError } from '../../util/handleError';
import { idStream, timeStream } from '../../util/stream/extendedStream';
import { AssistantMessage } from './AssistantMessage';
import { LoadingMessage } from './LoadingMessage';
import { UserMessage } from './UserMessage';

export type MessageActions = {};

function OnMount(props: {
  onShow: (ref: HTMLDivElement) => void;
  children: JSXElement;
}) {
  let ref: HTMLDivElement | undefined;
  onMount(() => {
    if (ref) props.onShow(ref);
  });
  return <div ref={ref}>{props.children}</div>;
}

type ChatMessages = {
  ChatMessages: () => JSXElement;
  addMessage: (message: ChatMessageWithAttachments) => void;
  setStream: (stream: MessageStream) => void;
  reset: () => void;
  messages: Accessor<ChatMessageWithAttachments[]>;
};

export function useChatMessages(args: {
  messages: ChatMessageWithAttachments[];
  actions?: MessageActions;
  chatId?: string;
  editDisabled?: Accessor<boolean>;
  pendingLocationParams?: Accessor<Record<string, string> | undefined>;
}): ChatMessages {
  const [messages, setMessages] = createSignal(args.messages);
  const [stream, setStream] = createSignal<MessageStream>();
  const addMessage = (message: ChatMessageWithAttachments) => {
    setMessages((p) => [...p, message]);
  };
  const editDisabled = createMemo(() => args.editDisabled?.());

  const CurriedChatMessages = createMemo(() => (
    <ChatMessages
      chatId={args.chatId}
      messages={[messages, setMessages]}
      messageActions={args.actions}
      stream={[stream, setStream]}
      editDisabled={editDisabled()}
      pendingLocationParams={args.pendingLocationParams}
    />
  ));

  const reset = () => {
    setMessages([]);
    setStream();
  };

  return {
    ChatMessages: CurriedChatMessages,
    addMessage,
    setStream,
    reset,
    messages,
  };
}

export type ChatMessagesProps = {
  messages: [
    Accessor<ChatMessageWithAttachments[]>,
    Setter<ChatMessageWithAttachments[]>,
  ];
  stream?: [
    Accessor<MessageStream | undefined>,
    Setter<MessageStream | undefined>,
  ];
  chatId?: string;
  messageActions?: MessageActions;
  editDisabled?: boolean;
  pendingLocationParams?: Accessor<Record<string, string> | undefined>;
};

function messageContentIsEmpty(message: ChatMessageWithAttachments) {
  if (typeof message.content === 'string' || Array.isArray(message.content)) {
    return message.content.length === 0;
  } else {
    return false;
  }
}

export function ChatMessages(props: ChatMessagesProps) {
  const [messages, setMessages] = props.messages;

  const extendedStream = createMemo(() => {
    const s = props.stream?.[0]?.();
    if (!s) return;
    return timeStream(idStream(s));
  });

  const [messageTimingMap, setTiming] = createStore<Record<string, number>>({});

  createEffect(() => {
    const stream = extendedStream();
    if (!stream) return;
    const ttft = stream.timeToFirstMessageMs();
    const id = stream.messageId();
    if (id && ttft) {
      console.log('ID TTFT', id, ttft);
      setTiming(id, ttft);
    }
  });

  let messagesRef: HTMLDivElement | undefined;

  const generatingMessage = () => {
    const streamAccessor = props.stream?.[0];
    if (!streamAccessor) return;
    const stream = streamAccessor();
    if (!stream) return;
    if (stream.isDone()) return;
    const parts = stream.data();
    const message = asChatMessage(parts);
    if (!message) return;
    if (messageContentIsEmpty(message)) return;
    return message;
  };

  const generatingAfterToolCall = () => {
    const streamAccessor = props.stream?.[0];
    if (!streamAccessor) return;
    const stream = streamAccessor();
    if (!stream || stream.isDone()) return;
    const message = asChatMessage(stream.data());
    if (!message || typeof message.content === 'string') return;
    const last = message.content.at(-1);
    if (!last) return;
    if (last.type === 'toolCallResponseJson') return true;
    return;
  };

  const isStream = () => {
    const streamSignal = props.stream?.[0];
    if (!streamSignal) return false;
    const stream = streamSignal();
    if (!stream) return false;
    return !stream.isDone();
  };

  const streamRequestAttachments = () => {
    const streamable = props.stream?.[0];
    if (!streamable) return [];
    const stream = streamable();
    if (!stream || !('attachments' in stream.request)) return [];
    return stream.request.attachments ?? [];
  };

  // when messages finish streaming, append and scroll
  createEffect(() => {
    if (!props.stream?.[0]) return;
    const s = props.stream?.[0]();
    if (!s) return;
    if (s.isDone()) {
      const message = asChatMessage(s.data());
      if (message) {
        message.model = 'model' in s.request ? s.request.model : undefined;
        setMessages((p) => {
          if (p.find((m) => m.id === message.id)) return p;
          return [...p, message];
        });
      }
    } else if (s.isErr()) {
      console.log(s);
      const err = s.err();
      if (err) handleError(err);
      else toast.failure('Failed to respond to message');
    }
  });

  const [parentHeight, setParentHeight] = createSignal(0);

  const selectScroll = () => {
    return messagesRef?.closest('[data-chat-scroll]');
  };

  const scrollRef = createElementSize(selectScroll);

  const isNearBottom = () => {
    const scrollRef = selectScroll();
    if (!scrollRef) return false;
    const threshold = 100; // pixels from bottom
    return (
      scrollRef.scrollTop + scrollRef.clientHeight >=
      scrollRef.scrollHeight - threshold
    );
  };

  const scrollToBottom = (behavior: 'instant' | 'smooth') => {
    const scrollRef = selectScroll();
    if (!scrollRef) {
      console.warn('Expected parent with data-chat-scroll attribute');
    } else {
      requestAnimationFrame(() =>
        scrollRef.scrollTo({
          behavior,
          top: scrollRef.scrollHeight - scrollRef.clientHeight,
        })
      );
    }
  };

  createEffect(() => {
    const size = scrollRef.height;
    if (!size) return;
    setParentHeight(size);
  });

  onMount(() => {
    scrollToBottom('instant');
  });

  // the highlight message id when arriving from search
  const [activeTargetMessageId, setActiveTargetMessageId] = createSignal<
    string | undefined
  >(undefined);

  createEffect(() => {
    const params = props.pendingLocationParams?.();
    if (!params) return;

    if (params.message_id) {
      setActiveTargetMessageId(params.message_id);
      setTimeout(() => {
        const messageElement = document.getElementById(
          `chat-${params.message_id}`
        );
        if (messageElement) {
          const scrollContainer = messageElement.closest(
            '[data-chat-scroll]'
          ) as HTMLElement;
          if (scrollContainer) {
            messageElement.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
        }
      }, 0);

      setTimeout(() => {
        setActiveTargetMessageId(undefined);
      }, 1500);
    }
  });

  const lastPair = () => {
    const msgs = messages();
    if (generatingMessage() || isStream()) {
      return msgs.slice(-1);
    } else if (msgs.length >= 2) {
      return msgs.slice(-2);
    } else {
      return msgs.slice(-1);
    }
  };

  const allButLastMessagePair = () => {
    const msgs = messages();
    if (generatingMessage() || isStream()) {
      return msgs.slice(0, -1);
    } else if (msgs.length >= 2) {
      return msgs.slice(0, -2);
    } else {
      return msgs.slice(0, -1);
    }
  };

  const activeIdSelector = createSelector(activeTargetMessageId);

  return (
    <StaticMarkdownContext theme={aiChatTheme}>
      <div class="relative flex flex-col w-full px-2 gap-y-2" ref={messagesRef}>
        <For each={allButLastMessagePair()}>
          {(msg) => (
            <div
              id={'chat-' + msg.id}
              class="w-full transition-colors duration-300"
              classList={{
                'bg-accent': activeIdSelector(msg.id),
              }}
            >
              <Switch>
                <Match when={msg.role === 'user'}>
                  <UserMessage message={msg} />
                </Match>
                <Match when={msg.role === 'assistant'}>
                  <AssistantMessage
                    message={msg}
                    ttft={messageTimingMap[msg.id]}
                  />
                </Match>
              </Switch>
            </div>
          )}
        </For>

        <Show when={isStream() || lastPair()}>
          <div
            class="shrink-0"
            style={{
              'min-height': `${parentHeight()}px`,
            }}
          >
            <Show when={lastPair()}>
              {(pair) => (
                <For each={pair()}>
                  {(msg) => (
                    <div
                      id={'chat-' + msg.id}
                      class="w-full transition-colors duration-300"
                      classList={{
                        'bg-accent': activeIdSelector(msg.id),
                      }}
                    >
                      <Switch>
                        <Match when={msg.role === 'user'}>
                          <UserMessage
                            message={msg}
                            edit={
                              props.editDisabled
                                ? undefined
                                : {
                                    chatId: props.chatId!,
                                    makeEdit: (send) => {
                                      const setStream = props?.stream?.[1];
                                      if (setStream) {
                                        setMessages((p) => {
                                          const last = p.at(-1);
                                          if (!last) return p;
                                          if (last.role === 'user') {
                                            return p.slice(0, -1);
                                          } else {
                                            return p.slice(0, -2);
                                          }
                                        });
                                        setMessages((p) => [
                                          ...p,
                                          {
                                            attachments:
                                              send.request.attachments ?? [],
                                            content: send.request.content,
                                            role: 'user',
                                            model: send.request.model,
                                            // TODO update message id from server response
                                            id: 'todo',
                                          },
                                        ]);
                                        setStream(send.call());
                                      }
                                    },
                                  }
                            }
                          />
                        </Match>
                        <Match when={msg.role === 'assistant'}>
                          <AssistantMessage
                            message={msg}
                            ttft={messageTimingMap[msg.id]}
                          />
                        </Match>
                      </Switch>
                    </div>
                  )}
                </For>
              )}
            </Show>
            <Show when={generatingMessage()}>
              {(msg) => {
                return (
                  <div id={'chat-' + msg().id}>
                    <AssistantMessage message={msg()} isStreaming />
                  </div>
                );
              }}
            </Show>
            {/* this works for most cases */}
            <Show when={!generatingMessage() && isStream()}>
              <OnMount
                onShow={() =>
                  scrollToBottom(isNearBottom() ? 'instant' : 'smooth')
                }
              >
                <LoadingMessage attachments={streamRequestAttachments()} />
              </OnMount>
            </Show>
            {/*
              This shows a spinner after a tool call
            */}
            <Show when={generatingAfterToolCall()}>
              <LoadingMessage attachments={[]} />
            </Show>
          </div>
        </Show>
      </div>
    </StaticMarkdownContext>
  );
}
