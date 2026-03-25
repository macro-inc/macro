import { useChatContext } from '@core/component/AI/context';
import type { ChatMessageWithAttachments } from '@core/component/AI/types';
import { asChatMessage } from '@core/component/AI/util/message';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import { PulsingStar } from '@entity/components/PulsingStar';
import { createElementSize } from '@solid-primitives/resize-observer';
import type { Accessor, JSXElement } from 'solid-js';
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
import { idStream, timeStream } from '../../util/stream/extendedStream';
import { AssistantMessage } from './AssistantMessage';
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
  const messages = chat.messages;
  const stream = chat.stream;

  const extendedStream = createMemo(() => {
    const s = stream();
    if (!s) return;
    return timeStream(idStream(s));
  });

  const [messageTimingMap, setTiming] = createStore<Record<string, number>>({});

  createEffect(() => {
    const s = extendedStream();
    if (!s) return;
    const ttft = s.timeToFirstMessageMs();
    const id = s.messageId();
    if (id && ttft) {
      setTiming(id, ttft);
    }
  });

  let messagesRef: HTMLDivElement | undefined;

  const generatingMessage = () => {
    const s = stream();
    if (!s) return;
    if (s.isDone()) return;
    const parts = s.data();
    const message = asChatMessage(parts);
    if (!message) return;
    if (messageContentIsEmpty(message)) return;
    return message;
  };

  const isStream = () => {
    const s = stream();
    console.log('isStream', Boolean(s));
    if (!s) return false;
    return !s.isDone();
  };

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

        <Show when={isStream() || chat.isWaiting() || lastPair()}>
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
            <Show when={isStream() || chat.isWaiting()}>
              <OnMount
                onShow={() =>
                  scrollToBottom(isNearBottom() ? 'instant' : 'smooth')
                }
              >
                <PulsingStar kind="streamIndicator" animate />
              </OnMount>
            </Show>
          </div>
        </Show>
      </div>
    </StaticMarkdownContext>
  );
}
