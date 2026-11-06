import type { tts as sdkTts } from '@livekit/agents';
import type { Emit } from './events.ts';
import { GatewayTts } from './inference.ts';
import type { SpeechGateway } from './speech.ts';
export const TTS_RATE = 24000;
export interface Tts {
  speak(text: string, turn: number): void;
  flush(turn: number): void;
  clear(): void;
  close(): void | Promise<void>;
}
export type TtsHandlers = {
  onAudio(pcm: Int16Array, turn: number): void;
  onDone(turn: number): void;
};

/** Each turn owns its inference session, so cancellation cannot leak old audio into a new turn. */
export function inferenceTts(
  gateway: SpeechGateway,
  emit: Emit,
  handlers: TtsHandlers,
  voice: string
): Tts {
  let current:
    | { model: GatewayTts; stream: sdkTts.SynthesizeStream; turn: number }
    | undefined;
  const pending = new Set<Promise<void>>();
  let closed = false;
  const start = (turn: number) => {
    if (current?.turn === turn) return current;
    clear();
    const model = new GatewayTts(gateway, voice);
    const stream = model.stream();
    const state = { model, stream, turn };
    current = state;
    const consume = (async () => {
      let first = true;
      try {
        for await (const packet of stream) {
          if (closed || current !== state) continue;
          if (typeof packet === 'symbol') continue;
          if (first) emit('tts.first_audio', { turn });
          first = false;
          handlers.onAudio(packet.frame.data.slice(), turn);
        }
        if (!closed && current === state) handlers.onDone(turn);
      } catch (error) {
        emit('tts.error', { turn, error: String(error) });
        if (!closed && current === state) handlers.onDone(turn);
      } finally {
        model.abortSockets();
        await model.close();
      }
    })();
    pending.add(consume);
    void consume
      .finally(() => pending.delete(consume))
      .catch((error: unknown) =>
        emit('tts.close_error', { error: String(error) })
      );
    return state;
  };
  const clear = () => {
    const previous = current;
    current = undefined;
    previous?.stream.close();
    previous?.model.abortSockets();
    emit('tts.clear');
  };
  return {
    speak(text, turn) {
      if (closed) return;
      emit('tts.speak', { turn, text });
      start(turn).stream.pushText(`${text} `);
    },
    flush(turn) {
      if (!closed) start(turn).stream.endInput();
    },
    clear,
    async close() {
      closed = true;
      clear();
      await Promise.all(pending);
    },
  };
}
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
