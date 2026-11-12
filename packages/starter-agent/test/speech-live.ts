/**
 * A live check of a call's speech, run by hand against a running harness:
 * the relay (`startRelay`) -> the harness's egress -> `/brain/inference/tts`
 * says a line in a catalog voice, then `/brain/inference/stt` hears that same
 * audio back. Exits 1 unless the line is heard.
 *
 *   EGRESS=http://localhost:<egress port> AGENT_KEY=<an agent teammate's mak_ key> \
 *     bun test/speech-live.ts
 *
 * The agent needs `enable-agent-teammates`, and the harness real LiveKit keys.
 * Never prints the key, the audio or anything but the heard line.
 */
import type WebSocket from 'ws';
import {
  hearing,
  openSpeech,
  speaking,
} from '../behavior/capabilities/calls/context/speech.ts';
import { startRelay } from '../behavior/context/relay.ts';

type ServerEvent = {
  readonly type: string;
  readonly audio?: string;
  readonly transcript?: string;
};

const line = 'The quick brown fox jumps over the lazy dog.';
const voice = { voice: 'thalia', language: 'en' } as const;
const openTimeoutMs = 10_000;
const eventTimeoutMs = 30_000;
const ttsRate = 24_000;
const sttRate = 16_000;
/** 100 ms of 16 kHz PCM16 per `input_audio`. */
const chunkBytes = 3_200;

const words = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim();

/** Every event until `done` says stop; rejects on a timeout or an early close. */
const collect = (
  socket: WebSocket,
  done: (event: ServerEvent) => boolean
): Promise<readonly ServerEvent[]> =>
  new Promise((resolve, reject) => {
    const seen: ServerEvent[] = [];
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${seen.map((e) => e.type)}`)),
      eventTimeoutMs
    );
    socket.on('message', (data) => {
      const event: ServerEvent = JSON.parse(String(data));
      seen.push(event);
      if (done(event)) {
        clearTimeout(timer);
        resolve(seen);
      }
    });
    socket.on('close', (code, reason) => {
      clearTimeout(timer);
      reject(new Error(`closed ${code} ${String(reason)}`));
    });
  });

/** 24 kHz to 16 kHz, linearly, with a second of silence so the utterance ends. */
const toSttRate = (pcm: Buffer): Buffer => {
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const spoken = Math.floor((input.length * sttRate) / ttsRate);
  const output = new Int16Array(spoken + sttRate);
  for (let index = 0; index < spoken; index++) {
    const at = (index * ttsRate) / sttRate;
    const low = Math.floor(at);
    const high = Math.min(low + 1, input.length - 1);
    output[index] = Math.round(
      (input[low] ?? 0) + ((input[high] ?? 0) - (input[low] ?? 0)) * (at - low)
    );
  }
  return Buffer.from(output.buffer);
};

const say = async (relay: ReturnType<typeof startRelay>): Promise<Buffer> => {
  const tts = await openSpeech(relay, 'tts', speaking(voice), openTimeoutMs);
  const events = collect(tts, (event) => event.type === 'done');
  tts.send(
    JSON.stringify({
      type: 'input_transcript',
      transcript: line,
      generation_config: { model: 'deepgram/aura-2', ...voice },
      extra: {},
    })
  );
  tts.send(JSON.stringify({ type: 'session.flush' }));
  const audio = Buffer.concat(
    (await events).flatMap((event) =>
      event.type === 'output_audio' && event.audio !== undefined
        ? [Buffer.from(event.audio, 'base64')]
        : []
    )
  );
  tts.close();
  return audio;
};

const hear = async (
  relay: ReturnType<typeof startRelay>,
  pcm: Buffer
): Promise<string> => {
  const stt = await openSpeech(relay, 'stt', hearing('Fox'), openTimeoutMs);
  const finals: string[] = [];
  const events = collect(stt, (event) => {
    if (event.type === 'final_transcript' && event.transcript)
      finals.push(event.transcript);
    return words(finals.join(' ')).includes(words(line));
  });
  for (let at = 0; at < pcm.length; at += chunkBytes)
    stt.send(
      JSON.stringify({
        type: 'input_audio',
        audio: pcm.subarray(at, at + chunkBytes).toString('base64'),
      })
    );
  stt.send(JSON.stringify({ type: 'session.finalize' }));
  await events;
  stt.close();
  return finals.join(' ');
};

const egress = process.env.EGRESS;
const apiKey = process.env.AGENT_KEY;
if (!egress || !apiKey) {
  console.error('set EGRESS and AGENT_KEY');
  process.exit(2);
}
const relay = startRelay({ targets: {}, egress, apiKey });
try {
  const audio = await say(relay);
  console.log(`said: ${(audio.length / 2 / ttsRate).toFixed(2)}s of audio`);
  if (audio.length === 0) throw new Error('no audio came back');
  console.log(`heard: ${await hear(relay, toSttRate(audio))}`);
} catch (error) {
  console.error(`speech check failed: ${String(error)}`);
  process.exitCode = 1;
} finally {
  relay.stop();
}
