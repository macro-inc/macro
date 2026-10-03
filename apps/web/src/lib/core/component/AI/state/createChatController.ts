import type { ChatMessageWithAttachments } from '@core/component/AI/types';
import { asChatMessage } from '@core/component/AI/util/message';
import {
  bufferedStream,
  createMentionBufferPlugin,
} from '@core/component/AI/util/stream';
import { tailContext } from '@core/component/LexicalMarkdown/tailContext';
import { toast } from '@core/component/Toast/Toast';
import { isTabFocused } from '@core/signal/tabFocus';
import { fetchAndCacheChat } from '@queries/cognition/chat-data';
import type { ChatMessageStream } from '@service-connection/stream';
import { getEntityStreams } from '@service-connection/stream';
import { createConnectionReconnectEffect } from '@service-connection/websocket';
import type { EditorState } from 'lexical';
import type { Accessor, Owner, Setter } from 'solid-js';
import {
  createEffect,
  createSignal,
  getOwner,
  on,
  runWithOwner,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ChatEvent,
  type ChatPhase,
  type SideEffect,
  transition,
} from './chatState';

type StreamConnectedEvent = {
  type: 'stream_connected';
  stream: ChatMessageStream;
  owner?: Owner | null;
};

type ControllerEvent =
  | Exclude<ChatEvent, { type: 'stream_connected' }>
  | StreamConnectedEvent;

export type ChatController = {
  chatId: Accessor<string>;
  phase: Accessor<ChatPhase>;
  messages: Accessor<ChatMessageWithAttachments[]>;
  setMessages: Setter<ChatMessageWithAttachments[]>;
  stream: Accessor<ChatMessageStream | undefined>;
  isGenerating: Accessor<boolean>;
  isWaiting: Accessor<boolean>;

  dispatch: (event: ControllerEvent) => void;
  /**
   * Check with the server whether the stream being waited on has already been
   * persisted as a message, and finish the turn with that message if so.
   * Resolves to whether the chat left `streaming`.
   *
   * A stream's end is only ever delivered over the socket. A client that
   * drops right before the end and reconnects after the gateway stops
   * replaying the stream would otherwise stay in `streaming` forever.
   */
  reconcile: () => Promise<boolean>;
  /**
   * Finish the turn with what has been received so far. For when the server
   * reports there is no stream left to stop, so no end will ever arrive.
   */
  abandonStream: () => void;
  /** Escape hatch for debug components that set stream directly */
  setStream: Setter<ChatMessageStream | undefined>;
  /**
   * Ref to the renderer's parsed editor state for the streaming message's
   * tail text part. The renderer sets it; the stream's Macro XML buffering
   * reads it to skip buffering tags that land in code blocks.
   */
  setStreamTailState: (
    state: Accessor<EditorState | null> | undefined,
    key?: string
  ) => void;
};

export type ChatControllerOptions = {
  onShowPaywall?: () => void;
  /**
   * The send was refused by the AI billing gate (allowance used up, usage
   * billing cap reached, or a failed usage charge). `reason` is the backend
   * code; hosts open the usage-limit dialog.
   */
  onShowUsageLimit?: (reason: string) => void;
  /**
   * Switch the chat to a model from a different provider. When provided, a
   * provider-outage error toast offers a "Switch model" button that calls this.
   */
  onSwitchModel?: () => void;
  /**
   * Whether an accessible model on another (non-failed) provider exists to
   * switch to. When this returns `false`, a provider-outage toast shows a plain
   * "try again later" message instead of a dead "Switch model" button. Defaults
   * to assuming an alternate exists when not provided.
   */
  hasAlternateModel?: () => boolean;
  /**
   * Load the chat's persisted messages, for `reconcile`. Defaults to fetching
   * the chat from the cognition service.
   */
  loadMessages?: (
    chatId: string
  ) => Promise<ChatMessageWithAttachments[] | undefined>;
};

async function loadPersistedMessages(
  chatId: string
): Promise<ChatMessageWithAttachments[] | undefined> {
  const result = await fetchAndCacheChat(chatId);
  if (result.isErr()) {
    console.warn('chat reconcile: failed to load messages', result.error);
    return undefined;
  }
  return result.value.chat.messages;
}

export function createChatController(
  chatId: string,
  initialMessages: ChatMessageWithAttachments[],
  options?: ChatControllerOptions
): ChatController {
  const [phase, setPhase] = createSignal<ChatPhase>({ type: 'idle' });
  const [messages, setMessages] =
    createSignal<ChatMessageWithAttachments[]>(initialMessages);
  const [stream, setStream] = createSignal<ChatMessageStream>();
  /*
   The unsmoothed stream behind `stream`. The buffered copy drips text out
   over time, so it lags the items actually received; finishing a turn early
   must use everything that arrived.
  */
  let sourceStream: ChatMessageStream | undefined;

  /*
   The renderer's parsed editor state for the streaming message's tail text
   part (set from AssistantMessageParts as it renders). Macro XML buffering
   reads the node tree the renderer already built — never parses — to skip
   buffering tags that land in code blocks, where they render literally.
  */
  let streamTailState: Accessor<EditorState | null> | undefined;
  let streamTailStateKey: string | undefined;
  function streamTailInCode(): boolean {
    const state = streamTailState?.();
    return state ? tailContext(state).inCode : false;
  }

  function executeEffects(effects: SideEffect[]) {
    for (const effect of effects) {
      match(effect)
        .with({ type: 'toast' }, (e) => {
          const onSwitchModel = options?.onSwitchModel;
          const canSwitch =
            !!e.offerModelSwitch &&
            !!onSwitchModel &&
            (options?.hasAlternateModel?.() ?? true);
          if (canSwitch) {
            toast.failure(e.message, {
              duration: 10000,
              actions: [{ label: 'Switch model', onClick: onSwitchModel! }],
            });
          } else if (e.offerModelSwitch) {
            // Provider outage but nowhere to fall back to (no accessible model
            // on another provider, or every other provider has already failed
            // this session). Don't offer a dead button — tell the user to wait.
            toast.failure(
              'The AI provider is currently unavailable. Please try again later.'
            );
          } else {
            toast.failure(e.message);
          }
        })
        .with({ type: 'show_paywall' }, () => options?.onShowPaywall?.())
        .with({ type: 'show_usage_limit' }, (e) =>
          options?.onShowUsageLimit?.(e.reason)
        )
        .exhaustive();
    }
  }

  function watchStream(newStream: ChatMessageStream) {
    // Watch stream data for user messages and errors
    createEffect(
      on(
        () => newStream.data(),
        (data) => {
          const latest = data.at(-1);
          if (!latest) return;

          match(latest)
            .with({ type: 'error' }, (r) => {
              const streamError =
                'stream_error' in r ? r.stream_error : undefined;
              dispatch({
                type: 'stream_error',
                streamError: streamError as string | undefined,
              });
            })
            .with({ type: 'chat_user_message' }, (r) => {
              dispatch({
                type: 'stream_user_message',
                messageId: r.message_id,
                content: r.content,
                attachments: r.attachments,
              });
            })
            .otherwise(() => {});
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

  function dispatch(event: ControllerEvent) {
    // Handle stream attachment through the state transition
    if (event.type === 'stream_connected' && 'stream' in event) {
      /* the previous message's tail state must not answer for this stream */
      streamTailState = undefined;
      streamTailStateKey = undefined;
      const makeStream = () =>
        bufferedStream(event.stream, [
          createMentionBufferPlugin(streamTailInCode),
        ]);
      const { owner = getOwner() } = event;
      let newStream: ReturnType<typeof bufferedStream>;
      if (owner) {
        const ownedStream = runWithOwner(owner, makeStream);
        if (!ownedStream) return;
        newStream = ownedStream;
      } else {
        newStream = makeStream();
      }
      sourceStream = event.stream;
      setStream(newStream);

      const result = transition(untrack(phase), { type: 'stream_connected' });
      setPhase(result.phase);
      executeEffects(result.effects);

      if (owner) {
        runWithOwner(owner, () => watchStream(newStream));
      } else {
        watchStream(newStream);
      }
      return;
    }

    const result = transition(untrack(phase), event);
    setPhase(result.phase);
    if (result.messages) {
      setMessages(result.messages);
    }
    // Clear stream on transition to idle
    if (result.phase.type === 'idle' && untrack(stream)) {
      setStream(undefined);
      sourceStream = undefined;
    }
    executeEffects(result.effects);
  }

  const loadMessages = options?.loadMessages ?? loadPersistedMessages;
  // Overlapping triggers (reconnect + refocus, or Stop during a reconcile)
  // share one request so a caller that awaits reconcile does not see a
  // premature "not finished" while the same stream is already being checked.
  let reconciling: { streamId: string; promise: Promise<boolean> } | undefined;

  /** The stream being waited on, if the chat is in `streaming`. */
  function awaitedStreamId(): string | undefined {
    if (untrack(phase).type !== 'streaming') return undefined;
    return untrack(stream)?.id()?.stream_id;
  }

  async function reconcile(): Promise<boolean> {
    const streamId = awaitedStreamId();
    if (!streamId) return false;
    if (reconciling?.streamId === streamId) return reconciling.promise;

    const promise = (async () => {
      try {
        const persisted = await loadMessages(chatId);
        // The stream may have finished on its own while the request was out.
        if (awaitedStreamId() !== streamId) return false;
        const message = persisted?.find(
          (m) => m.id === streamId && m.role === 'assistant'
        );
        if (!message) return false;
        dispatch({ type: 'stream_done', message });
        return true;
      } finally {
        if (reconciling?.streamId === streamId) reconciling = undefined;
      }
    })();
    reconciling = { streamId, promise };
    return promise;
  }

  function abandonStream() {
    const source = sourceStream;
    if (!awaitedStreamId() || !source) return;
    dispatch({ type: 'stream_done', message: asChatMessage(source.data()) });
  }

  // A reconnect replays the stream if it is still within the gateway's replay
  // window; the reconcile covers a stream that ended too long ago for that.
  createConnectionReconnectEffect(() => void reconcile());
  // A tab kept in the background may have had its socket throttled or
  // dropped without a reconnect event that this chat could act on.
  createEffect(
    on(
      isTabFocused,
      (focused) => {
        if (focused) void reconcile();
      },
      { defer: true }
    )
  );

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

      dispatch({ type: 'stream_connected', stream: s });
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
    reconcile,
    abandonStream,
    setStream,
    setStreamTailState: (state, key) => {
      if (!state) {
        if (key === undefined || key === streamTailStateKey) {
          streamTailState = undefined;
          streamTailStateKey = undefined;
        }
        return;
      }
      streamTailState = state;
      streamTailStateKey = key;
    },
  };
}
