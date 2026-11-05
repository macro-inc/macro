import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { Gain } from './audio.ts';
import type { Emit } from './events.ts';
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
export const LISTEN_PARAMS = {
  model: 'nova-3',
  encoding: 'linear16',
  sample_rate: '16000',
  channels: '1',
  interim_results: 'true',
  smart_format: 'true',
  endpointing: '300',
  utterance_end_ms: '1000',
  vad_events: 'true',
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
export function deepgramStt(
  gateway: SpeechGateway,
  emit: Emit,
  opts: {
    gain?: boolean;
    params?: Record<string, string>;
  } = {}
): SttFactory {
  return (who, onEvent) => {
    const gain = opts.gain ? new Gain() : null;
    const url = gateway.socket('listen', {
      ...LISTEN_PARAMS,
      keyterm: gateway.name,
      ...opts.params,
    });
    let ws: WebSocket;
    let pending: Uint8Array[] = [];
    let sent = 0;
    let base = 0;
    let closing = false;
    let lastSend = Date.now();
    let opened!: () => void;
    const open = new Promise<void>((r) => (opened = r));
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closing) return;
      ws = new WebSocket(url, { headers: gateway.headers() });
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        base = (sent - pending.length) * 20;
        emit('stt.open', { who, baseMs: base });
        for (const p of pending) ws.send(p);
        pending = [];
        opened();
      };
      ws.onmessage = (m) => {
        if (typeof m.data !== 'string') return;
        const e = parseDeepgram(JSON.parse(m.data));
        if (!e) return;
        if ('startMs' in e && e.startMs !== undefined) {
          e.startMs += base;
          if (e.endMs !== undefined) e.endMs += base;
        }
        const { kind, ...rest } = e;
        emit(`stt.${kind}`, { who, ...rest });
        onEvent(e);
      };
      ws.onerror = (e) => emit('stt.error', { who, error: String(e.message) });
      ws.onclose = (e) => {
        emit('stt.close', { who, code: e.code, reason: e.reason });
        if (!closing) reconnect = setTimeout(connect, 500);
      };
    };
    connect();
    const keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && Date.now() - lastSend > 4000)
        ws.send(JSON.stringify({ type: 'KeepAlive' }));
    }, 2000);
    return {
      send(frame) {
        const out = gain ? gain.apply(frame) : frame;
        const bytes = new Uint8Array(
          out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
        );
        lastSend = Date.now();
        sent++;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(bytes);
        } else {
          pending.push(bytes);
          if (pending.length > 500) pending.shift();
        }
      },
      async close() {
        closing = true;
        clearInterval(keepAlive);
        clearTimeout(reconnect);
        if (ws.readyState === WebSocket.CONNECTING) {
          await Promise.race([open, delay(3000)]);
        }
        if (ws.readyState !== WebSocket.OPEN) return ws.close();
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        await new Promise<void>((r) => {
          const timer = setTimeout(() => {
            ws.close();
            r();
          }, 5000);
          ws.addEventListener(
            'close',
            () => {
              clearTimeout(timer);
              r();
            },
            { once: true }
          );
        });
      },
    };
  };
}
