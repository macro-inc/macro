import WebSocket from 'ws';
import type { Emit } from './events.ts';
import type { SpeechGateway } from './speech.ts';

export const TTS_RATE = 24000;
export const VOICE = 'aura-2-arcas-en';

export interface Tts {
  speak(text: string, turn: number): void;

  flush(turn: number): void;
  clear(): void;
  close(): void;
}

export type TtsHandlers = {
  onAudio: (pcm: Int16Array, turn: number) => void;
  onDone: (turn: number) => void;
};

export function deepgramTts(
  gateway: SpeechGateway,
  emit: Emit,
  h: TtsHandlers,
  voice = VOICE
): Tts {
  const url = gateway.socket('speak', {
    model: voice,
    encoding: 'linear16',
    sample_rate: String(TTS_RATE),
    container: 'none',
  });
  let ws: WebSocket;
  let closing = false;
  let outbox: string[] = [];

  let flushes: number[] = [];
  let current: number | null = null;
  let firstAudio = new Set<number>();
  let dropping = false;
  let carry: Uint8Array | null = null;

  const send = (m: object) => {
    const s = JSON.stringify(m);
    if (ws.readyState === WebSocket.OPEN) ws.send(s);
    else outbox.push(s);
  };
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (closing) return;
    ws = new WebSocket(url, { headers: gateway.headers() });
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      emit('tts.open');
      for (const m of outbox) ws.send(m);
      outbox = [];
    };
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') {
        const j = JSON.parse(m.data) as { type: string };
        if (j.type === 'Flushed') {
          const turn = flushes.shift();
          if (turn !== undefined && !dropping) h.onDone(turn);
          current = flushes[0] ?? null;
        } else if (j.type === 'Cleared') dropping = false;
        else if (j.type === 'Warning' || j.type === 'Error')
          emit('tts.error', { message: m.data });
        return;
      }
      if (dropping || current === null) return;
      let bytes = new Uint8Array(m.data as ArrayBuffer);
      if (carry) {
        const b = new Uint8Array(carry.length + bytes.length);
        b.set(carry);
        b.set(bytes, carry.length);
        bytes = b;
        carry = null;
      }
      if (bytes.length % 2) {
        carry = bytes.slice(-1);
        bytes = bytes.slice(0, -1);
      }
      if (!firstAudio.has(current)) {
        firstAudio.add(current);
        emit('tts.first_audio', { turn: current });
      }
      h.onAudio(
        new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2),
        current
      );
    };
    ws.onerror = (e) => emit('tts.error', { error: String(e.message) });
    ws.onclose = (e) => {
      emit('tts.close', { code: e.code, reason: e.reason });

      for (const t of flushes) h.onDone(t);
      flushes = [];
      current = null;
      if (!closing) reconnect = setTimeout(connect, 300);
    };
  };
  connect();

  return {
    speak(text, turn) {
      if (current === null) current = turn;
      emit('tts.speak', { turn, text });
      send({ type: 'Speak', text });
    },
    flush(turn) {
      flushes.push(turn);
      if (current === null) current = turn;
      send({ type: 'Flush' });
    },
    clear() {
      outbox = [];
      dropping = ws.readyState === WebSocket.OPEN;
      flushes = [];
      current = null;
      carry = null;
      emit('tts.clear');
      if (dropping) send({ type: 'Clear' });
    },
    close() {
      closing = true;
      clearTimeout(reconnect);
      try {
        ws.send(JSON.stringify({ type: 'Close' }));
      } catch (error) {
        emit('tts.close_error', { error: String(error) });
      }
      ws.close();
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
