import { afterEach, expect, test } from 'bun:test';
import { initializeLogger } from '@livekit/agents';
import { gatewayStt, gatewayTts } from '../context/speech.ts';
import { parseVoice } from '../voices.ts';

initializeLogger({ pretty: false, level: 'warn' });

test("the voice is the one in the agent's config/voice.json, and Thalia until one is chosen", () => {
  expect(parseVoice('{"model":"aura-2-arcas-en"}')).toEqual({
    voice: 'arcas',
    language: 'en',
  });
  expect(parseVoice(undefined)).toEqual({ voice: 'thalia', language: 'en' });
});

test('a voice file that names no Aura-2 voice is refused, not spoken in another voice', () => {
  for (const text of [
    '{"model":"deepgram:aura-2-arcas-en"}',
    '{"model":"aura-2-Arcas-en"}',
    '{}',
    'not json',
  ])
    expect(() => parseVoice(text)).toThrow();
});

/** A relay that records how each socket was opened and the first message on it. */
const fakeRelay = () => {
  const opened: {
    path: string;
    capability: string | null;
    first?: unknown;
  }[] = [];
  const server = Bun.serve<{ readonly index: number }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => {
      opened.push({
        path: new URL(request.url).pathname,
        capability: request.headers.get('x-macro-user-api-key'),
      });
      return server.upgrade(request, { data: { index: opened.length - 1 } })
        ? undefined
        : new Response('no', { status: 400 });
    },
    websocket: {
      message: (socket, message) => {
        const entry = opened[socket.data.index];
        if (entry !== undefined && entry.first === undefined)
          entry.first = JSON.parse(String(message));
      },
    },
  });
  return { server, opened };
};

let stop: (() => void) | undefined;
afterEach(() => stop?.());

const firstMessage = async (
  opened: ReturnType<typeof fakeRelay>['opened']
): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (opened[0]?.first === undefined && Date.now() < deadline)
    await Bun.sleep(10);
};

test("hearing opens the relay's stt socket with its capability, and asks for Nova-3 with the agent's name as a keyterm", async () => {
  const { server, opened } = fakeRelay();
  stop = () => server.stop(true);
  const relay = { url: server.url.href.replace(/\/$/, ''), token: 'cap' };
  const socket = await gatewayStt(relay, 'Ada').connectWs(5000);
  await firstMessage(opened);
  socket.close();
  expect(opened).toEqual([
    {
      path: '/agent-harness/brain/inference/stt',
      capability: 'cap',
      first: {
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
            keyterm: 'Ada',
          },
        },
      },
    },
  ]);
});

test("speaking opens the relay's tts socket and asks for the chosen Aura-2 voice", async () => {
  const { server, opened } = fakeRelay();
  stop = () => server.stop(true);
  const relay = { url: server.url.href.replace(/\/$/, ''), token: 'cap' };
  const socket = await gatewayTts(relay, {
    voice: 'arcas',
    language: 'en',
  }).connectWs(5000);
  await firstMessage(opened);
  socket.close();
  expect(opened).toEqual([
    {
      path: '/agent-harness/brain/inference/tts',
      capability: 'cap',
      first: {
        type: 'session.create',
        model: 'deepgram/aura-2',
        voice: 'arcas',
        language: 'en',
        sample_rate: '24000',
        encoding: 'pcm_s16le',
        extra: {},
      },
    },
  ]);
});
