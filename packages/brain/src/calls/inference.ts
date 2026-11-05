import { inference, initializeLogger, loggerOptions } from '@livekit/agents';
import type WebSocket from 'ws';
import type { SpeechGateway } from './speech.ts';

function logging() {
  if (!loggerOptions()) initializeLogger({ pretty: false, level: 'warn' });
}

/** The pinned SDK exposes connectWs; Macro authenticates this transport instead of a project secret. */
export class GatewayStt extends inference.STT<'deepgram/nova-3'> {
  private readonly gateway: SpeechGateway;
  private readonly sockets = new Set<WebSocket>();
  private readonly cancellation = new AbortController();
  constructor(gateway: SpeechGateway) {
    logging();
    super({
      model: 'deepgram/nova-3',
      language: 'en',
      sampleRate: 16000,
      encoding: 'pcm_s16le',
      apiKey: 'macro-proxy',
      apiSecret: 'unused-by-macro-transport',
      modelOptions: {
        endpointing: 300,
        interim_results: true,
        smart_format: true,
        keyterm: gateway.name,
      },
    });
    this.gateway = gateway;
  }
  override async connectWs(timeout: number): Promise<WebSocket> {
    const socket = await this.gateway.open(
      'stt',
      timeout,
      {
        type: 'session.create',
        model: 'deepgram/nova-3',
        language: 'en',
        settings: {
          encoding: 'pcm_s16le',
          sample_rate: '16000',
          extra: {
            endpointing: 300,
            interim_results: true,
            smart_format: true,
            keyterm: this.gateway.name,
            // Documented Inference option missing from the pinned SDK's option type.
            utterance_end: true,
          },
        },
      },
      this.cancellation.signal
    );
    if (this.cancellation.signal.aborted) {
      socket.terminate();
      throw new Error('inference connection cancelled');
    }
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    return socket;
  }
  abortSockets() {
    this.cancellation.abort();
    for (const socket of this.sockets) socket.terminate();
  }
}

export class GatewayTts extends inference.TTS<'deepgram/aura-2'> {
  private readonly gateway: SpeechGateway;
  private readonly voice: string;
  private readonly language: string;
  private readonly sockets = new Set<WebSocket>();
  private readonly cancellation = new AbortController();
  constructor(gateway: SpeechGateway, model: string) {
    logging();
    const selector = /^aura-2-([a-z]+)-([a-z]{2})$/.exec(model);
    if (!selector) throw new Error('invalid Aura-2 voice selection');
    const voice = selector[1]!;
    const language = selector[2]!;
    super({
      model: 'deepgram/aura-2',
      voice,
      language,
      sampleRate: 24000,
      encoding: 'pcm_s16le',
      apiKey: 'macro-proxy',
      apiSecret: 'unused-by-macro-transport',
    });
    this.gateway = gateway;
    this.voice = voice;
    this.language = language;
  }
  override async connectWs(timeout: number): Promise<WebSocket> {
    const socket = await this.gateway.open(
      'tts',
      timeout,
      {
        type: 'session.create',
        model: 'deepgram/aura-2',
        voice: this.voice,
        language: this.language,
        sample_rate: '24000',
        encoding: 'pcm_s16le',
        extra: {},
      },
      this.cancellation.signal
    );
    if (this.cancellation.signal.aborted) {
      socket.terminate();
      throw new Error('inference connection cancelled');
    }
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    return socket;
  }
  abortSockets() {
    this.cancellation.abort();
    for (const socket of this.sockets) socket.terminate();
  }
}
