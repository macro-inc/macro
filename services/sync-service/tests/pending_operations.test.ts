import { createServer } from 'node:http';
import { LoroDoc } from 'loro-crdt';
import { expect, it, onTestFinished } from 'vitest';
import { createTestUser, setupMiniflare } from './utils';

it('clears snapshotted operations after repeated document reads', async () => {
  const saved = Promise.withResolvers<void>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    if (req.url?.endsWith('/snapshot')) {
      const snapshot = new LoroDoc();
      try {
        snapshot.import(Buffer.concat(chunks));
        if (snapshot.getText('content').toString() === 'Persist this edit') {
          saved.resolve();
        }
      } finally {
        snapshot.free();
      }
    }
    res.writeHead(200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing DSS address');
  const mf = await setupMiniflare({ dssUrl: `http://127.0.0.1:${address.port}` });
  onTestFinished(() => mf.dispose());
  const user = await createTestUser(mf, 'pending-operations');
  onTestFinished(() => {
    user.getWebSocket().close();
    user.doc.free();
  });
  const url = 'http://localhost/document/pending-operations';
  const headers = { 'x-internal-auth-key': 'local' };
  user.makeChange('Persist this edit');
  const ack = await user.readNextMessage();
  expect(ack.isRemoteUpdateAck()).toBe(true);

  // An acknowledged update remains in the pending log until the alarm saves it.
  const pending = await mf.dispatchFetch(`${url}/debug_dump_operations`, { headers });
  expect(pending.status).toBe(200);
  expect(await pending.json()).toHaveLength(1);
  for (let read = 0; read < 3; read++) {
    const exists = await mf.dispatchFetch(`${url}/exists`, { method: 'HEAD' });
    expect(exists.status).toBe(200);
    const metadata = await mf.dispatchFetch(`${url}/metadata`, { headers });
    expect(metadata.status).toBe(200);
    await metadata.arrayBuffer();
  }

  // The snapshot upload follows the durable save and pending-log cleanup.
  await saved.promise;
  const remaining = await mf.dispatchFetch(`${url}/debug_dump_operations`, { headers });
  expect(remaining.status).toBe(200);
  expect(await remaining.json()).toEqual([]);

  const response = await mf.dispatchFetch(`${url}/snapshot`, { method: 'POST', headers });
  expect(response.status).toBe(200);
  const restored = new LoroDoc();
  try {
    restored.import(new Uint8Array(await response.arrayBuffer()));
    expect(restored.getText('content').toString()).toBe('Persist this edit');
  } finally {
    restored.free();
  }
}, 20_000);
