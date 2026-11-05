import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { SpeechGateway } from './speech.ts';

test('rescue sends only unresolved PCM on a fresh finalized inference session', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const inputs: number[][] = [];
  server.on('connection', (peer, request) => {
    assert.equal(request.headers.authorization, 'Bearer agent-key');
    const samples: number[] = [];
    inputs.push(samples);
    peer.on('message', (data) => {
      const event: {
        type: string;
        audio?: string;
        settings?: { extra?: { keyterm?: string } };
      } = JSON.parse(data.toString());
      if (event.type === 'session.create') {
        assert.equal(event.settings?.extra?.keyterm, 'Agent');
        peer.send(
          JSON.stringify({ type: 'session.created', session_id: 'rescue' })
        );
      }
      if (event.type === 'input_audio') {
        assert(event.audio);
        const pcm = Buffer.from(event.audio, 'base64');
        for (let i = 0; i < pcm.length; i += 2)
          samples.push(pcm.readInt16LE(i));
      }
      if (event.type === 'session.finalize') {
        peer.send(
          JSON.stringify({
            type: 'final_transcript',
            session_id: 'rescue',
            transcript: 'Unresolved words.',
            start: 0,
            duration: 0.02,
            confidence: 1,
            language: 'en',
            words: [],
          })
        );
        peer.send(
          JSON.stringify({ type: 'session.finalized', session_id: 'rescue' })
        );
      }
      if (event.type === 'session.close') {
        peer.send(
          JSON.stringify({ type: 'session.closed', session_id: 'rescue' })
        );
        peer.close();
      }
    });
  });
  try {
    const gateway = new SpeechGateway(
      `http://127.0.0.1:${address.port}`,
      'agent-key',
      'Agent'
    );
    assert.equal(
      await gateway.rescue(new Int16Array(320).fill(42)),
      'Unresolved words.'
    );
    assert.equal(
      await gateway.rescue(new Int16Array(320).fill(17)),
      'Unresolved words.'
    );
    assert.equal(inputs.length, 2);
    assert.deepEqual(inputs[0]?.slice(0, 320), Array(320).fill(42));
    assert.deepEqual(inputs[1]?.slice(0, 320), Array(320).fill(17));
    assert(
      inputs.every((samples) =>
        samples.slice(320).every((value) => value === 0)
      )
    );
  } finally {
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
