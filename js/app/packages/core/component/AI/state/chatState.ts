import type { ChatMessageWithAttachments } from '@core/component/AI/types';
import type { Entity } from '@service-cognition/generated/schemas/entity';
import { match, P } from 'ts-pattern';

// --- Phases ---

export type ChatPhase =
  | { type: 'idle' }
  | { type: 'sending'; optimisticMessageId: string }
  | { type: 'streaming' };

// --- Events ---

export type ChatEvent =
  | {
      type: 'send_started';
      optimisticMessage: ChatMessageWithAttachments;
    }
  | { type: 'send_failed'; paymentError?: boolean }
  | { type: 'stream_connected' }
  | {
      type: 'stream_user_message';
      messageId: string;
      content: string;
      attachments: Entity[];
    }
  | {
      type: 'stream_done';
      message: ChatMessageWithAttachments | undefined;
    }
  | {
      type: 'stream_error';
      streamError: string | undefined;
    };

export type SideEffect =
  | { type: 'toast'; message: string }
  | { type: 'show_paywall' };

// --- Transition result ---

export type TransitionResult = {
  phase: ChatPhase;
  messages?: (
    prev: ChatMessageWithAttachments[]
  ) => ChatMessageWithAttachments[];
  effects: SideEffect[];
};

const rejected = (phase: ChatPhase, event: string): TransitionResult => {
  console.warn(`chat transition: ${event} from ${phase.type}`);
  return { phase, effects: [] };
};

export function transition(
  phase: ChatPhase,
  event: ChatEvent
): TransitionResult {
  return match([phase, event] as const)
    .with([{ type: 'idle' }, { type: 'send_started' }], ([, e]) => ({
      phase: {
        type: 'sending' as const,
        optimisticMessageId: e.optimisticMessage.id,
      },
      messages: (prev: ChatMessageWithAttachments[]) => [
        ...prev,
        e.optimisticMessage,
      ],
      effects: [],
    }))

    .with([{ type: 'sending' }, { type: 'send_failed' }], ([, e]) => ({
      phase: { type: 'idle' as const },
      effects: e.paymentError
        ? ([{ type: 'show_paywall' }] as SideEffect[])
        : [],
    }))

    .with(
      [{ type: P.union('idle', 'sending') }, { type: 'stream_connected' }],
      () => ({
        phase: { type: 'streaming' as const },
        effects: [],
      })
    )

    .with(
      [
        { type: P.union('sending', 'streaming') },
        { type: 'stream_user_message' },
      ],
      ([, e]) => {
        return {
          phase: { type: 'streaming' as const },
          messages: (prev: ChatMessageWithAttachments[]) => {
            if (prev.find((m) => m.role === 'user' && m.content === e.content))
              return prev;
            return [
              ...prev,
              {
                id: e.messageId,
                content: e.content,
                role: 'user' as const,
                attachments: e.attachments,
              },
            ];
          },
          effects: [],
        };
      }
    )

    .with([{ type: 'streaming' }, { type: 'stream_done' }], ([, e]) => ({
      phase: { type: 'idle' as const },
      messages: e.message
        ? (prev: ChatMessageWithAttachments[]) => {
            if (prev.find((m) => m.id === e.message!.id)) return prev;
            return [...prev, e.message!];
          }
        : undefined,
      effects: [],
    }))

    .with(
      [{ type: P.union('streaming', 'sending') }, { type: 'stream_error' }],
      ([, e]) => ({
        phase: { type: 'idle' as const },
        effects: [
          {
            type: 'toast' as const,
            message:
              e.streamError === 'model_context_overflow'
                ? 'Too much context. Remove attachments or start a new chat'
                : 'Failed to respond to message',
          },
        ],
      })
    )
    .otherwise(([p, e]) => rejected(p, e.type));
}
