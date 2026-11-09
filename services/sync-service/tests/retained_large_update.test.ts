import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeImportBlobMeta, LoroDoc } from 'loro-crdt';
import { createFetchMock } from 'miniflare';
import { expect, test } from 'vitest';
import { FromPeer, FromRemote, InitializeFromSnapshotRequest } from '../../../crates/sync_protocol/bebop/generated/schema';
import { createTestUser, getTokenForDocument, setupMiniflare } from './utils';

// Opaque source bytes remain outside the repository. Exact hashes prevent this
// real failure witness from silently turning into a smaller synthetic payload.
test.runIf(process.env.SYNC_CHUNK_WRITER === '1' && Boolean(process.env.SYNC_RETAINED_UPDATE_DIR))('retained 4847484-byte update receives a durable receipt and survives workerd restart', async () => {
  const source = process.env.SYNC_RETAINED_UPDATE_DIR!;
  const update = new Uint8Array(readFileSync(join(source, 'storage-003.bin')));
  expect(update.length).toBe(4_847_484);
  expect(createHash('sha256').update(update).digest('hex')).toBe('ee419eba46d293e71a3bc9ef255fb1fb546b26f22b6c80c694320bd8e0800fe3');
  const frame = new Uint8Array(readFileSync(join(source, 'server-000.bin')));
  expect(frame.length).toBe(1084);
  expect(createHash('sha256').update(frame).digest('hex')).toBe('ec185f2daf2417caca25ba1a44617a18546d96d61e1826a0984a60dcc6c6f744');
  expect(frame[0]).toBe(1);
  const initial = FromRemote.decode(frame.subarray(1));
  if (!initial.isRemoteInitialSync()) throw new Error('Expected recorded initial sync');
  const expected = new LoroDoc();
  expected.import(initial.value.snapshot);
  expected.import(update);
  const retainedStore = process.env.SYNC_RETAINED_STORE;
  const directory = retainedStore ?? await mkdtemp(join(tmpdir(), 'sync-retained-operation-'));
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  for (const method of ['POST', 'PUT']) {
    fetchMock.get('https://dss.test').intercept({path: /.*/, method}).reply(200, '').persist();
  }
  const options = {record: false, persistPath: directory, holdAlarms: true, fetchMock};
  let mf = await setupMiniflare(options);
  const id = 'retained-large-operation';
  try {
    const initialized = await mf.dispatchFetch(`http://localhost/document/${id}/initialize`, {
      method: 'POST', headers: {'x-internal-auth-key': 'local'},
      body: InitializeFromSnapshotRequest.encode({snapshot: initial.value.snapshot}),
    });
    expect(initialized.status).toBe(200);
    const user = await createTestUser(mf, id);
    for (const peer of decodeImportBlobMeta(update, true).partialEndVersionVector.toJSON().keys()) {
      user.send(FromPeer.fromPeerRegisterId({peerid: BigInt(peer)}).encode());
    }
    user.send(FromPeer.fromPeerUpdate({updates: [update], id: 'retained-update'}).encode());
    const ack = FromRemote.decode(new Uint8Array(await user.waitForNextMessage(30_000) as ArrayBuffer));
    expect(ack.isRemoteUpdateAck() && ack.value.id).toBe('retained-update');
    user.getWebSocket().close();
    await mf.dispose();
    mf = await setupMiniflare({...options, migrate: false});
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = namespace.get(namespace.idFromName(id));
    // Direct real-DO read tests cold pending-log recovery without conflating
    // the separate front worker's short HTTP timeout with persistence safety.
    const response = await stub.fetch(`http://localhost/document/${id}/snapshot`, {
      headers: {authorization: `Bearer ${getTokenForDocument(id, 'fixture-user', 'owner')}`},
    });
    expect(response.status).toBe(200);
    const restored = new LoroDoc();
    restored.import(new Uint8Array(await response.arrayBuffer()));
    expect(restored.toJSON()).toEqual(expected.toJSON());
    expect(restored.oplogVersion().toJSON()).toEqual(expected.oplogVersion().toJSON());
    expect(restored.oplogFrontiers()).toEqual(expected.oplogFrontiers());
    restored.free();
  } finally {
    await mf.dispose();
    expected.free();
    if (!retainedStore) await rm(directory, {recursive: true, force: true});
  }
}, 90_000);
