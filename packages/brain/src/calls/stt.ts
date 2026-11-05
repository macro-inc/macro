import { stt } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { match } from 'ts-pattern';
import type { Emit } from './events.ts';
import { GatewayStt } from './inference.ts';
import type { SpeechGateway } from './speech.ts';
export type SttEvent =
  | {
      kind: 'speech_started';
    }
  | {
      kind: 'interim';
      text: string;
      startMs?: number;
      endMs?: number;
    }
  | {
      kind: 'final';
      text: string;
      speechFinal: boolean;
      startMs?: number;
      endMs?: number;
    }
  | {
      kind: 'utterance_end';
    }
  | {
      kind: 'voice';
    }
  | {
      kind: 'unheard';
    };
export function parseDeepgram(msg: unknown): SttEvent | null {
  const m = msg as {
    type?: string;
    is_final?: boolean;
    speech_final?: boolean;
    start?: number;
    duration?: number;
    channel?: {
      alternatives?: {
        transcript?: string;
      }[];
    };
  };
  const at =
    m.start !== undefined && m.duration !== undefined
      ? {
          startMs: Math.round(m.start * 1000),
          endMs: Math.round((m.start + m.duration) * 1000),
        }
      : {};
  if (m.type === 'SpeechStarted') return { kind: 'speech_started' };
  if (m.type === 'UtteranceEnd') return { kind: 'utterance_end' };
  if (m.type !== 'Results') return null;
  const text = m.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
  if (m.is_final)
    return text || m.speech_final
      ? { kind: 'final', text, speechFinal: !!m.speech_final, ...at }
      : null;
  return text ? { kind: 'interim', text, ...at } : null;
}
export interface Stt {
  send(frame: Int16Array): void;
  close(): Promise<void>;
}
export type SttFactory = (who: string, onEvent: (e: SttEvent) => void) => Stt;

export function inferenceEvent(event: stt.SpeechEvent): SttEvent | null {
  const alternative = event.alternatives?.[0];
  const text = alternative?.text.trim() ?? '';
  const at =
    alternative && alternative.endTime > alternative.startTime
      ? {
          startMs: Math.round(alternative.startTime * 1000),
          endMs: Math.round(alternative.endTime * 1000),
        }
      : {};
  return match(event.type)
    .with(
      stt.SpeechEventType.START_OF_SPEECH,
      () => ({ kind: 'speech_started' }) as const
    )
    .with(
      stt.SpeechEventType.END_OF_SPEECH,
      () => ({ kind: 'utterance_end' }) as const
    )
    .with(stt.SpeechEventType.INTERIM_TRANSCRIPT, () =>
      text ? { kind: 'interim' as const, text, ...at } : null
    )
    .with(stt.SpeechEventType.FINAL_TRANSCRIPT, () => ({
      kind: 'final' as const,
      text,
      speechFinal: true,
      ...at,
    }))
    .otherwise(() => null);
}

export function inferenceStt(
  gateway: SpeechGateway,
  emit: Emit,
  onError: (error: unknown) => void
): SttFactory {
  return (who, onEvent) => {
    const model = new GatewayStt(gateway);
    const stream = model.stream();
    let closing = false;
    const consume = (async () => {
      for await (const event of stream) {
        const converted = inferenceEvent(event);
        if (!converted) continue;
        const { kind, ...data } = converted;
        emit(`stt.${kind}`, { who, ...data });
        onEvent(converted);
      }
      if (!closing)
        throw (
          stream.terminalError ??
          new Error('speech inference ended unexpectedly')
        );
    })();
    void consume.catch((error: unknown) => {
      emit('stt.error', { who, error: String(error) });
      if (!closing) onError(error);
    });
    return {
      send(frame) {
        if (!closing)
          stream.pushFrame(
            new AudioFrame(frame.slice(), 16000, 1, frame.length)
          );
      },
      async close() {
        if (closing) return;
        closing = true;
        stream.endInput();
        const deadline = setTimeout(() => {
          emit('stt.close_timeout', { who });
          stream.close();
          model.abortSockets();
        }, 5000);
        try {
          await consume;
        } finally {
          clearTimeout(deadline);
          stream.close();
          model.abortSockets();
          await model.close();
        }
      },
    };
  };
}
