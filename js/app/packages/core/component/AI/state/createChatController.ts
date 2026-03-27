import type { ChatMessageWithAttachments } from '@core/component/AI/types';
import { asChatMessage } from '@core/component/AI/util/message';
import { toast } from '@core/component/Toast/Toast';
import type { ChatMessageStream } from '@service-connection/stream';
import { getEntityStreams } from '@service-connection/stream';
import type { Accessor, Setter } from 'solid-js';
import { createEffect, createSignal, on, untrack } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ChatEvent,
  type ChatPhase,
  type SideEffect,
  transition,
} from './chatState';

export type ChatController = {
  chatId: Accessor<string>;
  phase: Accessor<ChatPhase>;
  messages: Accessor<ChatMessageWithAttachments[]>;
  setMessages: Setter<ChatMessageWithAttachments[]>;
  stream: Accessor<ChatMessageStream | undefined>;
  isGenerating: Accessor<boolean>;
  isWaiting: Accessor<boolean>;

  dispatch: (event: ChatEvent) => void;
  attachStream: (stream: ChatMessageStream) => void;
  /** Escape hatch for debug components that set stream directly */
  setStream: Setter<ChatMessageStream | undefined>;
};

export type ChatControllerOptions = {
  onShowPaywall?: () => void;
};

export function createChatController(
  chatId: string,
  initialMessages: ChatMessageWithAttachments[],
  options?: ChatControllerOptions
): ChatController {
  const [phase, setPhase] = createSignal<ChatPhase>({ type: 'idle' });
  const [messages, setMessages] =
    createSignal<ChatMessageWithAttachments[]>(initialMessages);
  const [stream, setStream] = createSignal<ChatMessageStream>();

  function executeEffects(effects: SideEffect[]) {
    for (const effect of effects) {
      match(effect)
        .with({ type: 'toast' }, (e) => toast.failure(e.message))
        .with({ type: 'show_paywall' }, () => options?.onShowPaywall?.())
        .exhaustive();
    }
  }

  function dispatch(event: ChatEvent) {
    const result = transition(untrack(phase), event);
    setPhase(result.phase);
    if (result.messages) {
      setMessages(result.messages);
    }
    // Clear stream on transition to idle
    if (result.phase.type === 'idle' && untrack(stream)) {
      setStream(undefined);
    }
    executeEffects(result.effects);
  }

  function attachStream(newStream: ChatMessageStream) {
    setStream(newStream);
    dispatch({ type: 'stream_connected' });

    // Watch stream data for user messages and errors
    createEffect(
      on(
        () => newStream.data(),
        (data) => {
          const latest = data.at(-1);
          if (!latest) return;

          if (latest.type === 'error') {
            const streamError =
              'stream_error' in latest ? latest.stream_error : undefined;
            dispatch({
              type: 'stream_error',
              streamError: streamError as string | undefined,
            });
            return;
          }

          if (latest.type === 'chat_user_message') {
            dispatch({
              type: 'stream_user_message',
              messageId: latest.message_id,
              content: latest.content,
              attachments: latest.attachments,
            });
          }
        }
      )
    );

    // Watch stream completion
    createEffect(() => {
      if (!newStream.isDone()) return;
      const message = asChatMessage(newStream.data());
      dispatch({ type: 'stream_done', message });
    });
  }

  // Reconnect active streams on page refresh / chat switch
  createEffect(() => {
    const activeStreams = getEntityStreams('chat', chatId)();
    const currentStream = untrack(stream);

    for (const s of activeStreams) {
      const sid = s.id()?.stream_id;
      if (!sid) {
        console.warn('reject chat stream: no id');
        continue;
      }
      if (currentStream?.isDone() && currentStream?.id()?.stream_id === sid) {
        console.warn('reject chat stream: duplicate stream');
        continue;
      }

      const isInMessages = untrack(() => messages().some((m) => m.id === sid));
      if (isInMessages) {
        console.warn('reject chat stream: already has message');
        continue;
      }

      attachStream(s);
      break;
    }
  });

  return {
    chatId: () => chatId,
    phase,
    messages,
    setMessages,
    stream,
    isGenerating: () => phase().type === 'streaming',
    isWaiting: () => phase().type === 'sending',

    dispatch,
    attachStream,
    setStream,
  };
}
