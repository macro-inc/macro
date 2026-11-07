import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Miniflare } from 'miniflare';
import { LoroDoc, LoroMap, LoroText } from 'loro-crdt';
import { FromPeer, InitializeFromSnapshotRequest } from '../../../crates/sync_protocol/bebop/generated/schema';
import { abortObjectBetweenMessages, createTestUser, dispatchConcurrent, getTokenForDocument, getTokenForSurface, setupMiniflare } from './utils';

let mf: Miniflare;
beforeEach(async () => { mf = await setupMiniflare(); });
afterEach(async () => { await mf?.dispose(); });

async function stub(id: string) {
  const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
  return namespace.get(namespace.idFromName(id));
}

async function request(id: string, path: string) {
  return mf.dispatchFetch(`http://localhost/document/${id}/${path}`, {
    headers: { authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}` },
  });
}

test('E7 websocket errors retain existing awareness', async () => {
  const id = 'transcript-error';
  const writer = await createTestUser(mf, id);
  const observer = await createTestUser(mf, id);
  writer.awareness.set(writer.doc.peerIdStr, { marker: 'present' });
  writer.send(FromPeer.fromPeerAwareness({ awareness: writer.awareness.encode(writer.doc.peerIdStr) }).encode());
  expect((await observer.readNextMessage()).isRemoteAwareness()).toBe(true);
  const target = await stub(id);
  expect((await target.fetch('http://sync-test/__sync_test_error')).status).toBe(204);
  const joined = await createTestUser(mf, id);
  expect(joined.awareness.getAllStates()[writer.doc.peerIdStr]).toEqual({ marker: 'present' });
});

test('A3 and R2 corrupt state gives 500 and skips alarm rearming', async () => {
  const id = 'transcript-corrupt';
  const snapshots = await mf.getKVNamespace('SNAPSHOT_STORE_KV');
  await snapshots.put(`${id}/${id}.snapshot`, new Uint8Array([0]));
  expect((await request(id, 'raw')).status).toBe(500);
  const target = await stub(id);
  const alarm = await target.fetch('http://sync-test/__sync_test_alarm');
  expect(alarm.status).toBe(200);
  expect(await alarm.text()).toBe('');
  const dump = await (await target.fetch('http://sync-test/__sync_test_dump')).json() as { alarm: number | null };
  expect(dump.alarm).toBeNull();
});

test('A8 wakeup returns the previous keepalive tuple', async () => {
  const id = 'transcript-wakeup';
  expect(await (await request(id, 'wakeup')).json()).toBeNull();
  const previous = await (await request(id, 'wakeup')).json() as number[];
  expect(previous).toHaveLength(2);
  expect(previous[1]).toBe(60_000);
});

test('M14 unknown Bebop variants produce no acknowledgement', async () => {
  const writer = await createTestUser(mf, 'transcript-unknown');
  writer.send(new Uint8Array([1, 0, 0, 0, 0]));
  writer.send('ping');
  expect(await writer.waitForNextMessage()).toBe('pong');
});

test('M12 echoes the exact request version vector', async () => {
  const writer = await createTestUser(mf, 'transcript-since');
  const vv = writer.doc.oplogVersion().encode();
  writer.makeChange('after the requested version');
  expect((await writer.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  writer.send(FromPeer.fromPeerRequestSince({ vv }).encode());
  const response = await writer.readNextMessage();
  expect(response.isRemoteUpdateSince()).toBe(true);
  expect(response.value.vv).toEqual(vv);
});

test('A4 compaction retains acknowledged pending imports until dependencies arrive', async () => {
  const id = 'transcript-pending-import';
  const writer = await createTestUser(mf, id);
  const initialVersion = writer.doc.oplogVersion();
  writer.doc.getText('content').push('missing dependency');
  writer.doc.commit();
  const dependency = writer.doc.export({ mode: 'update', from: initialVersion });
  const from = writer.doc.oplogVersion();
  writer.doc.getText('content').push('pending suffix');
  writer.doc.commit();
  const pending = writer.doc.export({ mode: 'update', from });
  writer.send(FromPeer.fromPeerUpdate({ updates: [pending], id: 'pending-import' }).encode());
  expect((await writer.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  const target = await stub(id);
  expect(await (await target.fetch('http://sync-test/__sync_test_alarm')).text()).toBe('ok');
  const dump = await (await target.fetch('http://sync-test/__sync_test_dump')).json() as { kv: [string, unknown][]; kv_bytes: [string, { bytes_b64: string }][] };
  expect(dump.kv.some(([key]) => key.startsWith('o/'))).toBe(true);
  expect(dump.kv.some(([key]) => key.startsWith('a/'))).toBe(true);
  const response = await request(id, 'snapshot');
  const restored = new LoroDoc();
  restored.import(new Uint8Array(await response.arrayBuffer()));
  const retained = dump.kv_bytes.filter(([key]) => key.startsWith('o/'));
  for (const [, value] of retained) restored.import(Buffer.from(value.bytes_b64, 'base64'));
  expect(restored.getText('content').toString()).toBe('');
  restored.import(dependency);
  expect(restored.getText('content').toString()).toBe('missing dependencypending suffix');
  restored.free();
});

async function lexicalEdit(id: string) {
  const writer = await createTestUser(mf, id);
  const root = writer.doc.getMap('root');
  root.setContainer('$', new LoroMap()).set('id', 'node');
  root.setContainer('text', new LoroText()).insert(0, 'blamed text');
  writer.doc.commit();
  writer.send(FromPeer.fromPeerUpdate({ updates: [writer.doc.export({ mode: 'update' })], id: 'blame-edit' }).encode());
  expect((await writer.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  return writer;
}

test('A5 flushes blame but eviction loses the pending in-memory batch', async () => {
  await lexicalEdit('transcript-blame-flush');
  const flushed = await stub('transcript-blame-flush');
  await (await flushed.fetch('http://sync-test/__sync_test_alarm')).text();
  expect((await request('transcript-blame-flush', 'blame/node')).status).toBe(200);

  await lexicalEdit('transcript-blame-lost');
  const lost = await stub('transcript-blame-lost');
  await abortObjectBetweenMessages(lost);
  await (await lost.fetch('http://sync-test/__sync_test_alarm')).text();
  expect((await request('transcript-blame-lost', 'blame/node')).status).toBe(404);
});

test('S9 serves the exact checked-in wire schema', async () => {
  const response = await mf.dispatchFetch('http://localhost/schema');
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(readFileSync('../../crates/sync_protocol/bebop/schema.bop', 'utf8'));
});


test('C4 expired-during-connect grants are accepted before returning 403', async () => {
  const id = '00000000-0000-4000-8000-000000000004';
  const doc = new LoroDoc();
  const initialized = await mf.dispatchFetch(`http://localhost/surface/${id}/initialize`, {
    method: 'POST', headers: { 'x-internal-auth-key': 'local' },
    body: InitializeFromSnapshotRequest.encode({ snapshot: doc.export({ mode: 'snapshot' }) }),
  });
  expect(initialized.status).toBe(200);
  const expiry = Math.floor(Date.now() / 1000) + 2;
  const response = await mf.dispatchFetch(`http://localhost/surface/${id}/connect?token=${getTokenForSurface(id, 'edit', expiry)}`, {
    headers: { Upgrade: 'websocket', 'x-sync-test-stop-after': `expire_after_accept:${expiry}` },
  });
  expect(response.status).toBe(403);
  const target = await stub(`surface:${id}`);
  const dump = await (await target.fetch('http://sync-test/__sync_test_dump')).json() as { accepted: number };
  expect(dump.accepted).toBe(1);
  doc.free();
});

test('M2 ping fails after DOCUMENT_ID is removed', async () => {
  const id = 'transcript-missing-id';
  const writer = await createTestUser(mf, id);
  writer.send('ping');
  expect(await writer.waitForNextMessage()).toBe('pong');
  const target = await stub(id);
  expect((await target.fetch('http://sync-test/__sync_test_forget_id')).status).toBe(204);
  await abortObjectBetweenMessages(target);
  writer.getWebSocket().send('ping');
  await expect(writer.connection.waitForNextMessage(100)).rejects.toThrow('Timed out');
  writer.getWebSocket().close();
}, 15_000);

test('R10 deletion retains the mapped-writing-peer cache', async () => {
  const id = 'transcript-delete-cache';
  const original = await createTestUser(mf, id);
  original.makeChange('before deletion');
  expect((await original.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  const deleted = await mf.dispatchFetch(`http://localhost/document/${id}/delete`, {
    method: 'DELETE', headers: { 'x-internal-auth-key': 'local' },
  });
  expect(deleted.status).toBe(200);
  const replacement = await createTestUser(mf, id);
  original.doc.getText('content').push(' after deletion');
  original.doc.commit();
  replacement.send(FromPeer.fromPeerUpdate({ updates: [original.doc.export({ mode: 'update' })], id: 'reused-writing-peer' }).encode());
  expect((await replacement.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  expect((await request(id, `peer/${original.doc.peerIdStr}`)).status).toBe(500);
});


test('E2 serializes overlapping fetches across a pending storage put', async () => {
  const id = '00000000-0000-4000-8000-000000000002';
  const doc = new LoroDoc();
  await mf.dispatchFetch(`http://localhost/surface/${id}/initialize`, {
    method: 'POST', headers: { 'x-internal-auth-key': 'local' },
    body: InitializeFromSnapshotRequest.encode({ snapshot: doc.export({ mode: 'snapshot' }) }),
  });
  const expiry = Math.floor(Date.now() / 1000) + 2;
  const first = dispatchConcurrent(mf, `http://localhost/surface/${id}/connect?token=${getTokenForSurface(id, 'edit', expiry)}`, {
    headers: { Upgrade: 'websocket', 'x-sync-test-stop-after': `expire_after_accept:${expiry}` },
  });
  const target = await stub(`surface:${id}`);
  await expect.poll(async () => (await target.fetch('http://sync-test/__sync_test_accept_count')).json()).toBe(1);
  let finished = false;
  const second = dispatchConcurrent(mf, `http://localhost/surface/${id}/snapshot`, {
    method: 'POST',
    headers: { authorization: `Bearer ${getTokenForSurface(id)}` },
  }).then(response => { finished = true; return response; });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(finished).toBe(false);
  expect((await first).status).toBe(403);
  expect((await second).status).toBe(200);
  doc.free();
});
