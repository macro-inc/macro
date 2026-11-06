import { stt } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';
import { context } from '@opentelemetry/api';
import WebSocket from 'ws';
import { traceHeaders } from '../telemetry.ts';
import { frames } from './audio.ts';
import type { Rescue } from './ear.ts';
import { GatewayStt } from './inference.ts';

/** Macro proxies LiveKit Inference. Project credentials never enter this process. */
export class SpeechGateway {
  private readonly traceContext = context.active();
  readonly baseUrl: string;
  private readonly apiKey: string;
  readonly name: string;
  constructor(baseUrl: string, apiKey: string, name: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.name = name;
  }
  forName(name: string): SpeechGateway {
    return new SpeechGateway(this.baseUrl, this.apiKey, name);
  }
  headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...context.with(this.traceContext, traceHeaders),
    };
  }
  async open(
    operation: 'stt' | 'tts',
    timeout: number,
    create: object,
    signal: AbortSignal
  ): Promise<WebSocket> {
    signal.throwIfAborted();
    const model = operation === 'stt' ? 'deepgram/nova-3' : 'deepgram/aura-2';
    const url = new URL(`${this.baseUrl}/${operation}`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({ model }).toString();
    const socket = new WebSocket(url, { headers: this.headers() });
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
        };
        const abort = () => {
          cleanup();
          socket.terminate();
          reject(new Error('inference connection cancelled'));
        };
        const timer = setTimeout(() => {
          cleanup();
          socket.terminate();
          reject(new Error('inference connection timed out'));
        }, timeout);
        socket.once('open', () => {
          cleanup();
          resolve();
        });
        socket.once('error', (error) => {
          cleanup();
          reject(error);
        });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      signal.throwIfAborted();
      socket.send(JSON.stringify(create));
      return socket;
    } catch (error) {
      socket.terminate();
      throw error;
    }
  }
  /** Inference has no batch API: retry just the unresolved span on a fresh finalized stream. */
  readonly rescue: Rescue = async (samples) => {
    const model = new GatewayStt(this);
    const stream = model.stream();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stream.close();
      model.abortSockets();
    }, 8000);
    const text: string[] = [];
    try {
      for (const frame of frames(samples, 320))
        stream.pushFrame(new AudioFrame(frame, 16000, 1, frame.length));
      stream.pushFrame(new AudioFrame(new Int16Array(8000), 16000, 1, 8000));
      stream.endInput();
      for await (const event of stream)
        if (event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
          const value = event.alternatives?.[0]?.text;
          if (value) text.push(value);
        }
      if (timedOut) throw new Error('speech rescue timed out');
      if (stream.terminalError) throw stream.terminalError;
      return text.join(' ');
    } finally {
      clearTimeout(timer);
      stream.close();
      model.abortSockets();
      await model.close();
    }
  };
}
