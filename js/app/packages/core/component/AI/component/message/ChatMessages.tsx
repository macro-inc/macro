import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { useAdditionalInstructions } from '@core/component/AI/constant/prompts';
import { useChatContext } from '@core/component/AI/context';
import type {
  ChatMessageStream,
  ChatMessageWithAttachments,
} from '@core/component/AI/types';
import { asChatMessage } from '@core/component/AI/util/message';
import { getMacroApiToken } from '@service-auth/fetch';
import { cognitionWebsocketServiceClient } from '@service-cognition/client';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { createElementSize } from '@solid-primitives/resize-observer';
import type { Accessor, JSXElement, Setter } from 'solid-js';
import {
  on,
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

export type ChatMessagesProps = {
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
  const chat = useChatContext();
  const [messages, setMessages] = [chat.messages, chat.setMessages];
  const streamTuple: [
    Accessor<ChatMessageStream | undefined>,
    Setter<ChatMessageStream | undefined>,
  ] = [chat.stream, chat.setStream];
  const chatId = chat.chatId;
  const additionalInstructions = useAdditionalInstructions();

  const makeEdit = async (data: ChatSendInput) => {
    const setStream = streamTuple?.[1];
    if (!setStream) return;

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
        attachments: data.attachments ?? [],
        content: data.content,
        role: 'user',
        model: data.model,
        id: 'todo',
      },
    ]);

    const token = await getMacroApiToken();
    const modelInstructions = data.model ? `\nYou are ${data.model}` : '';
    const additional = `${additionalInstructions()}${modelInstructions}`;
    const editStream = cognitionWebsocketServiceClient.streamEditMessage({
      chat_id: chatId()!,
      content: data.content,
      model: data.model ?? DEFAULT_MODEL,
      attachments: data.attachments ?? [],
      token,
      additional_instructions: additional,
      toolset: data.toolset,
    });

    setStream({
      data: editStream.data,
      isDone: editStream.isDone,
      model: data.model ?? DEFAULT_MODEL,
      attachments: data.attachments ?? [],
    });
  };

  const extendedStream = createMemo(() => {
    const s = streamTuple?.[0]?.();
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
    const streamAccessor = streamTuple?.[0];
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
    const streamAccessor = streamTuple?.[0];
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
    const streamSignal = streamTuple?.[0];
    if (!streamSignal) return false;
    const stream = streamSignal();
    if (!stream) return false;
    return !stream.isDone();
  };

  const streamRequestAttachments = () => {
    const streamable = streamTuple?.[0];
    if (!streamable) return [];
    const stream = streamable();
    if (!stream) return [];
    return stream.attachments ?? [];
  };

  const streamData = () => {
    const stream = streamTuple?.[0]?.();
    if (!stream) return [];
    return stream.data();
  };
  // when a user message arrives via stream, update optimistic ID or append
  createEffect(
    on(streamData, (data) => {
      const latest = data.at(-1);
      if (!latest) return;
      if (latest.type !== 'chat_user_message') return;
      setMessages((p) => {
        const last = p.at(-1);
        if (last?.role === 'user' && last?.content === latest.content) {
          // Patch the optimistic message with the real server ID
          if (last.id !== latest.message_id) {
            const updated = p.slice();
            updated[updated.length - 1] = { ...last, id: latest.message_id };
            return updated;
          }
          return p;
        }
        return [
          ...p,
          {
            id: latest.message_id,
            content: latest.content,
            role: 'user' as const,
            attachments: latest.attachments,
          },
        ];
      });
    })
  );

  // when messages finish streaming, append and scroll
  createEffect(() => {
    if (!streamTuple?.[0]) return;
    const s = streamTuple?.[0]();
    if (!s) return;
    if (s.isDone()) {
      const message = asChatMessage(s.data());
      if (message) {
        message.model = s.model;
        setMessages((p) => {
          if (p.find((m) => m.id === message.id)) return p;
          return [...p, message];
        });
      }
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

        <Show when={isStream() || chat.waitingForStream() || lastPair()}>
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
                                    chatId: chatId()!,
                                    makeEdit,
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
            <Show
              when={
                !generatingMessage() && (isStream() || chat.waitingForStream())
              }
            >
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
