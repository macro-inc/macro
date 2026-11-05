import assert from 'node:assert/strict';
import { on, once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { SpeechGateway } from './speech.ts';
import { deepgramTts } from './tts.ts';

test('barge-in discards stale audio and flush acknowledgments before the new turn', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const connected = once(server, 'connection');
  const audio: number[] = [];
  const completed: number[] = [];
  const finished = Promise.withResolvers<void>();
  const tts = deepgramTts(
    new SpeechGateway(`http://127.0.0.1:${address.port}`, 'agent-key', 'Agent'),
    () => {},
    {
      onAudio(pcm, turn) {
        assert.equal(turn, 2);
        audio.push(...pcm);
      },
      onDone(turn) {
        completed.push(turn);
        finished.resolve();
      },
    },
    'aura-2-thalia-en'
  );
  const [peer, request] = await connected;
  assert.equal(request.headers.authorization, 'Bearer agent-key');
  assert(request.url.includes('model=aura-2-thalia-en'));
  const controls = on(peer, 'message');
  try {
    tts.speak('First answer.', 1);
    tts.flush(1);
    await controls.next();
    await controls.next();
    tts.clear();
    tts.speak('Replacement answer.', 2);
    tts.flush(2);
    await controls.next();
    await controls.next();
    await controls.next();
    peer.send(JSON.stringify({ type: 'Flushed' }));
    peer.send(new Uint8Array([33, 0]));
    peer.send(JSON.stringify({ type: 'Cleared' }));
    peer.send(new Uint8Array([1]));
    peer.send(new Uint8Array([0, 2, 0]));
    peer.send(JSON.stringify({ type: 'Flushed' }));
    await finished.promise;
    assert.deepEqual(audio, [1, 2]);
    assert.deepEqual(completed, [2]);
  } finally {
    await controls.return?.();
    const closed = once(peer, 'close');
    tts.close();
    await closed;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
