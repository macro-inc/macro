import { assert, expect, test } from 'vitest';
import { FromPeer } from '../bebop/generated/schema';
import { createTestUser, getTokenForDocument, setupMiniflare } from './utils';

test.each(['websocket', 'http'])('joined reader receives a durable suffix when its missing parent arrives through %s', async (ingress) => {
  const mf = await setupMiniflare({holdAlarms: true, workerScriptPath: './tests/reader-worker.mjs'});
  try {
    const id = 'resolved-history-reader';
    const writer = await createTestUser(mf, id);
    const baseline = writer.doc.oplogVersion();
    writer.doc.getText('content').push('parent');
    writer.doc.commit();
    const parent = writer.doc.export({mode: 'update', from: baseline});
    const before = writer.doc.oplogVersion();
    writer.doc.getText('content').push('-child');
    writer.doc.commit();
    const suffix = writer.doc.export({mode: 'update', from: before});
    writer.send(FromPeer.fromPeerUpdate({updates: [suffix], id: 'suffix'}).encode());
    expect((await writer.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    const reader = await createTestUser(mf, id);
    expect(reader.getState()).toBe('');
    reader.send(FromPeer.fromPeerRequestSince({vv: reader.doc.oplogVersion().encode()}).encode());
    const catchup = await reader.readNextMessage();
    assert(catchup.isRemoteUpdateSince());
    reader.import(catchup.value.update);
    expect(reader.getState()).toBe('');
    // A read must not replace the storage bookkeeping while retaining the doc.
    const snapshot = await mf.dispatchFetch(`http://localhost/document/${id}/snapshot`, {
      headers: { authorization: `Bearer ${getTokenForDocument(id, 'actor', 'owner')}` },
    });
    expect(snapshot.status).toBe(200);
    if (ingress === 'websocket') {
      writer.send(FromPeer.fromPeerUpdate({updates: [parent], id: 'parent'}).encode());
      expect((await writer.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    } else {
      const response = await mf.dispatchFetch(`http://localhost/document/${id}/update`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getTokenForDocument(id, 'actor', 'edit')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expectedRevision: Buffer.from(reader.doc.oplogVersion().encode()).toString('base64'),
          update: Buffer.from(parent).toString('base64'),
        }),
      });
      expect(response.status).toBe(200);
      const result = await response.json() as { revision: string };
      expect((await import('loro-crdt')).VersionVector.decode(new Uint8Array(Buffer.from(result.revision, 'base64'))).toJSON()).toEqual(writer.doc.oplogVersion().toJSON());
      const ordinaryWriter = await writer.readNextMessage().catch(error => { throw new Error("ordinaryWriter: " + String(error)); });
      assert(ordinaryWriter.isRemoteUpdate());
      expect(ordinaryWriter.value.update).toEqual(parent);
    }
    const ordinary = await reader.readNextMessage().catch(error => { throw new Error("ordinary: " + String(error)); });
    assert(ordinary.isRemoteUpdate());
    expect(ordinary.value.update).toEqual(parent);
    reader.import(ordinary.value.update);
    expect(reader.getState()).toBe('parent');
    const resolved = await reader.readNextMessage().catch(error => { throw new Error("resolved: " + String(error)); });
    assert(resolved.isRemoteUpdate());
    reader.import(resolved.value.update);
    expect(reader.getState()).toBe('parent-child');
    expect(reader.doc.oplogVersion().toJSON()).toEqual(writer.doc.oplogVersion().toJSON());
    const alreadyPresent = await writer.readNextMessage().catch(error => { throw new Error("alreadyPresent: " + String(error)); });
    assert(alreadyPresent.isRemoteUpdate());
    const previous = writer.doc.oplogVersion().toJSON();
    writer.import(alreadyPresent.value.update);
    expect(writer.getState()).toBe('parent-child');
    expect(writer.doc.oplogVersion().toJSON()).toEqual(previous);
    writer.getWebSocket().close();
    reader.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);
