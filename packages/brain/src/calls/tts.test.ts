import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { type WebSocket, WebSocketServer } from 'ws';
import { SpeechGateway } from './speech.ts';
import { inferenceTts } from './tts.ts';

test('clearing during an inference handshake aborts it before any synthesis is sent', {
  timeout: 10000,
}, async () => {
  const server = createServer();
  const upgrading = Promise.withResolvers<Promise<unknown[]>>();
  server.on('upgrade', (_request, socket) => {
    upgrading.resolve(once(socket, 'close'));
    socket.once('end', () => socket.end());
    socket.resume();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const speech = inferenceTts(
    new SpeechGateway(`http://127.0.0.1:${address.port}`, 'agent-key', 'Agent'),
    () => {},
    {
      onAudio: () => assert.fail('cancelled synthesis produced audio'),
      onDone: () => assert.fail('cancelled synthesis completed'),
    },
    'aura-2-thalia-en'
  );
  try {
    speech.speak('Cancelled before connection.', 1);
    speech.flush(1);
    const closed = upgrading.promise;
    // Wait for the request without resolving through the close promise.
    await once(server, 'upgrade');
    speech.clear();
    await speech.close();
    await closed;
  } finally {
    await speech.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('inference barge-in closes the old synthesis connection before a replacement can play', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const firstInput = Promise.withResolvers<WebSocket>();
  const finished = Promise.withResolvers<void>();
  let connections = 0;
  const replacementText: string[] = [];
  server.on('connection', (peer, request) => {
    const generation = ++connections;
    assert.equal(request.headers.authorization, 'Bearer agent-key');
    assert.equal(
      new URL(request.url ?? '', 'http://localhost').searchParams.get('model'),
      'deepgram/aura-2'
    );
    peer.on('message', (data) => {
      const event: { type: string; voice?: string; transcript?: string } =
        JSON.parse(data.toString());
      if (event.type === 'session.create') {
        assert.equal(event.voice, 'thalia');
        peer.send(
          JSON.stringify({
            type: 'session.created',
            session_id: `session-${generation}`,
          })
        );
      }
      if (event.type === 'input_transcript' && generation === 1)
        firstInput.resolve(peer);
      if (event.type === 'input_transcript' && generation === 2)
        replacementText.push(event.transcript ?? '');
      if (event.type === 'session.flush' && generation === 2) {
        peer.send(
          JSON.stringify({
            type: 'output_audio',
            session_id: 'session-2',
            audio: Buffer.from([1, 0, 2, 0]).toString('base64'),
          })
        );
        peer.send(JSON.stringify({ type: 'done', session_id: 'session-2' }));
      }
    });
  });
  const audio: number[] = [];
  const completed: number[] = [];
  const speech = inferenceTts(
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
  try {
    speech.speak('First answer.', 1);
    speech.flush(1);
    const previous = await firstInput.promise;
    const previousClosed = once(previous, 'close');
    speech.clear();
    speech.speak('Replacement answer.', 2);
    speech.speak('A second sentence.', 2);
    speech.flush(2);
    await previousClosed;
    await finished.promise;
    assert.equal(connections, 2);
    assert.deepEqual(audio, [1, 2]);
    assert.deepEqual(completed, [2]);
    assert.match(replacementText.join(''), /answer\. A second sentence\./);
  } finally {
    await speech.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
