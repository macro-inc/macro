/**
 * A call's ears and voice: LiveKit Inference (Deepgram Nova-3 and Aura-2),
 * reached through Macro's speech gateway, which holds the project's keys and
 * bills the team. A call's process has no Macro key either: it opens the
 * socket on the agent's relay (`context/relay.ts`), which adds the key.
 *
 * LiveKit's inference classes sign their own token from a LiveKit key; these
 * override only `connectWs`, so the socket goes to the relay with the relay's
 * capability. Classes, because LiveKit's session takes instances of its own.
 */
import { inference } from '@livekit/agents';
import WebSocket from 'ws';
import { keyHeader } from '../../../context/relay.ts';
import type { Voice } from '../voices.ts';

/** The relay a call's process reaches Macro through. */
export type SpeechRelay = { readonly url: string; readonly token: string };

const sttModel = 'deepgram/nova-3';
const ttsModel = 'deepgram/aura-2';
const sttRate = 16_000;
const ttsRate = 24_000;
const encoding = 'pcm_s16le';
/** LiveKit's constructor wants these; the relay, not LiveKit, authenticates. */
const unused = { apiKey: 'macro-relay', apiSecret: 'macro-relay' };

/** Opens a speech socket on the relay and sends its `session.create`. */
export const openSpeech = (
  relay: SpeechRelay,
  path: 'stt' | 'tts',
  create: object,
  timeoutMs: number
): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${relay.url.replace(/^http/, 'ws')}/speech/${path}`,
      { headers: { [keyHeader]: relay.token } }
    );
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`speech ${path} didn't open within ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once('open', () => {
      clearTimeout(timer);
      socket.send(JSON.stringify({ type: 'session.create', ...create }));
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

/** What hearing asks for: Deepgram's options, and the agent's name as a keyterm so it's spelled right. */
export const hearing = (name: string) => ({
  model: sttModel,
  language: 'en',
  settings: {
    encoding,
    sample_rate: String(sttRate),
    extra: {
      endpointing: 300,
      interim_results: true,
      smart_format: true,
      // Documented by LiveKit Inference, missing from the pinned SDK's option type.
      utterance_end: true,
      keyterm: name,
    },
  },
});

/** What speaking asks for, in the agent's voice. */
export const speaking = ({ voice, language }: Voice) => ({
  model: ttsModel,
  voice,
  language,
  sample_rate: String(ttsRate),
  encoding,
  extra: {},
});

export const gatewayStt = (
  relay: SpeechRelay,
  name: string
): inference.STT<'deepgram/nova-3'> => {
  const create = hearing(name);
  return new (class extends inference.STT<'deepgram/nova-3'> {
    override connectWs(timeout: number): Promise<WebSocket> {
      return openSpeech(relay, 'stt', create, timeout);
    }
  })({
    model: sttModel,
    language: 'en',
    sampleRate: sttRate,
    encoding,
    ...unused,
    modelOptions: create.settings.extra,
  });
};

export const gatewayTts = (
  relay: SpeechRelay,
  voice: Voice
): inference.TTS<'deepgram/aura-2'> => {
  const create = speaking(voice);
  return new (class extends inference.TTS<'deepgram/aura-2'> {
    override connectWs(timeout: number): Promise<WebSocket> {
      return openSpeech(relay, 'tts', create, timeout);
    }
  })({
    model: ttsModel,
    voice: voice.voice,
    language: voice.language,
    sampleRate: ttsRate,
    encoding,
    ...unused,
  });
};
