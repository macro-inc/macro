import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LoroDoc } from 'loro-crdt';
import { createFetchMock } from 'miniflare';
import { expect, test } from 'vitest';
import { FromPeer } from '../../../crates/sync_protocol/bebop/generated/schema';
import { abortObjectBetweenMessages, createTestUser, getTokenForDocument, setupMiniflare } from './utils';

// Activation requires a separate build, after reader-only rollout. Persistent
// runtimes deliberately do not enter the byte-exact small-message corpus.
test.runIf(process.env.SYNC_CHUNK_WRITER === '1')('oversized operations commit atomically, replay with legacy rows and compact', async () => {
  const retained = process.env.SYNC_CHUNK_READER_STORE;
  const directory = retained ?? await mkdtemp(join(tmpdir(), 'sync-operation-chunks-'));
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  for (const method of ['POST', 'PUT']) {
    fetchMock.get('https://dss.test').intercept({ path: /.*/, method }).reply(200, '').persist();
  }
  let mf = await setupMiniflare({record: false,  persistPath: directory, fetchMock, holdAlarms: true });
  try {
    const id = 'large-operation-fixture';
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    let stub = namespace.get(namespace.idFromName(id));
    const user = await createTestUser(mf, id);
    const dump = async () => (await stub.fetch('http://sync-test/__sync_test_dump')).json() as Promise<{kv: [string, unknown][]}>;
    const snapshot = async () => {
      const response = await stub.fetch(`http://localhost/document/${id}/snapshot`, {
        headers: { authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}` },
      });
      expect(response.status).toBe(200);
      const doc = new LoroDoc();
      doc.import(new Uint8Array(await response.arrayBuffer()));
      return doc;
    };
    const inlineBoundary = await stub.fetch('http://sync-test/__sync_test_sqlite_row_limit?size=524288&array=1');
    expect(inlineBoundary.status).toBe(200);
    expect(await inlineBoundary.json()).toEqual({array: true, length: 524288, first: 255, last: 255});
    // Exercise the pinned runtime's row limit directly, including binary buffers.
    expect((await stub.fetch('http://sync-test/__sync_test_sqlite_row_limit?size=262144')).status).toBe(204);
    const oversized = await stub.fetch('http://sync-test/__sync_test_sqlite_row_limit?size=9000000');
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).toContain('SQLITE_TOOBIG');

    const limits = [];
    for (const size of [1_900_000, 2_100_000, 2_199_995, 2_199_996]) {
      const probe = await stub.fetch(`http://sync-test/__sync_test_sqlite_row_limit?size=${size}`);
      limits.push({size, status: probe.status});
      if (probe.status === 413) expect(await probe.text()).toContain('SQLITE_TOOBIG');
    }
    expect(limits[0].status).toBe(204);
    console.log('pinned SQLite binary row probes', limits);
    expect(limits.map(probe => probe.status)).toEqual([204, 204, 204, 413]);

    user.makeChange('legacy prefix\n');
    expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    // An actual unwrapped deployed row must coexist with new receipt manifests.
    await stub.fetch('http://sync-test/__sync_test_operation_archive?legacy=present');
    const legacy = (await dump()).kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'));
    expect(legacy.length).toBe(1);
    expect(Array.isArray(legacy[0][1])).toBe(true);
    const from = user.doc.version();
    user.doc.getMap('large').set('content', randomBytes(3_600_000).toString('base64'));
    user.doc.commit();
    const update = user.doc.export({mode: 'update', from});
    expect(update.length).toBeGreaterThan(4_000_000);
    const message = FromPeer.fromPeerUpdate({updates: [update], id: 'large-row'}).encode();

    await stub.fetch('http://sync-test/__sync_test_operation_chunks?failAt=2');
    user.send(message);
    // A ping is handled after the failed callback; an accidental receipt would
    // arrive first and fail this assertion. No timeout substitutes for a barrier.
    user.send('ping');
    expect(await user.waitForNextMessage()).toBe('pong');
    const failed = await dump();
    expect(failed.kv.filter(([key]) => key.startsWith('operation-chunks/'))).toEqual([]);
    expect(failed.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'))).toEqual(legacy);
    await abortObjectBetweenMessages(stub);
    const beforeRetry = await snapshot();
    expect(beforeRetry.getText('content').toString()).toBe('legacy prefix\n');
    beforeRetry.free();

    // Retry the same logical message. Receipt covers the complete operation.
    user.send(message);
    const receipt = await user.readNextMessage();
    expect(receipt.isRemoteUpdateAck() && receipt.value.id).toBe('large-row');
    const stored = await dump();
    expect(stored.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!')).length).toBe(2);
    expect(stored.kv.filter(([key]) => key.startsWith('operation-chunks/o/')).length).toBeGreaterThan(1);
    expect(stored.kv.filter(([key]) => key.startsWith('operation-chunks/a/')).length).toBeGreaterThan(1);
    expect(stored.kv.find(([key]) => key === legacy[0][0])).toEqual(legacy[0]);
    user.getWebSocket().close();
    await mf.dispose();
    mf = await setupMiniflare({record: false,  persistPath: directory, fetchMock, holdAlarms: true, migrate: false });
    const coldNamespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    stub = coldNamespace.get(coldNamespace.idFromName(id));
    const replayed = await snapshot();
    expect(replayed.toJSON()).toEqual(user.doc.toJSON());
    expect(replayed.oplogVersion().toJSON()).toEqual(user.doc.oplogVersion().toJSON());
    replayed.free();

    if (retained) {
      await writeFile(join(directory, 'expected.json'), JSON.stringify({
        state: createHash('sha256').update(JSON.stringify(user.doc.toJSON())).digest('hex'),
        vv: [...user.doc.oplogVersion().toJSON()],
        archive: stored.kv.find(([key, value]) => key.startsWith('a/') && !Array.isArray(value))?.[0],
        operation: createHash('sha256').update(update).digest('hex'),
      }));
      return;
    }

    // A real post-restart edit marks the cold-replayed document dirty under the
    // existing snapshot policy; replay alone does not invent a new local write.
    const editor = await createTestUser(mf, id);
    const afterRestart = editor.doc.version();
    editor.doc.getText('content').push('after restart');
    editor.doc.commit();
    editor.send(FromPeer.fromPeerUpdate({updates: [editor.doc.export({mode: 'update', from: afterRestart})], id: 'after-restart'}).encode());
    expect((await editor.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    // Real alarm snapshots the document and removes pending physical chunks.
    await stub.fetch('http://sync-test/__sync_test_flush_alarm');
    const compacted = await dump();
    expect(compacted.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!') || key.startsWith('operation-chunks/o/'))).toEqual([]);
    expect(compacted.kv.filter(([key]) => key.startsWith('operation-chunks/a/')).length).toBeGreaterThan(1);
    editor.getWebSocket().close();
    await mf.dispose();
    mf = await setupMiniflare({record: false,  persistPath: directory, fetchMock, holdAlarms: true, migrate: false });
    const snapshotNamespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    stub = snapshotNamespace.get(snapshotNamespace.idFromName(id));
    const restored = await snapshot();
    expect(restored.toJSON()).toEqual(editor.doc.toJSON());
    expect(restored.oplogVersion().toJSON()).toEqual(editor.doc.oplogVersion().toJSON());
    restored.free();
  } finally {
    await mf.dispose();
    if (!retained) await rm(directory, {recursive: true, force: true});
  }
}, 60_000);

// Run against the SAME persisted directory after rebuilding WITHOUT the writer
// feature. This is a cross-build compatibility proof, not a synthetic manifest.
test.runIf(Boolean(process.env.SYNC_CHUNK_READER_STORE) && process.env.SYNC_CHUNK_WRITER !== '1')('reader-only build restores mixed legacy and activated operation records', async () => {
  const directory = process.env.SYNC_CHUNK_READER_STORE!;
  const expected = JSON.parse(await readFile(join(directory, 'expected.json'), 'utf8'));
  const mf = await setupMiniflare({record: false, persistPath: directory, migrate: false, holdAlarms: true});
  try {
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = namespace.get(namespace.idFromName('large-operation-fixture'));
    const response = await stub.fetch('http://localhost/document/large-operation-fixture/snapshot', {
      headers: {authorization: `Bearer ${getTokenForDocument('large-operation-fixture', 'test-user', 'owner')}`},
    });
    expect(response.status).toBe(200);
    const doc = new LoroDoc();
    doc.import(new Uint8Array(await response.arrayBuffer()));
    expect(createHash('sha256').update(JSON.stringify(doc.toJSON())).digest('hex')).toBe(expected.state);
    expect([...doc.oplogVersion().toJSON()]).toEqual(expected.vv);
    doc.free();
    const dump = await (await stub.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
    expect(dump.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!')).length).toBe(2);
    expect(dump.kv.some(([key, value]) => key.startsWith('o/') && !key.startsWith('o/!') && Array.isArray(value))).toBe(true);
    // Archive/debug reads use the same unconditional reader as pending replay.
    const archived = await stub.fetch(`http://localhost/document/large-operation-fixture/debug_do_kv_get/${encodeURIComponent(expected.archive)}`, {
      headers: {'x-internal-auth-key': 'local'},
    });
    expect(archived.status).toBe(200);
    const bytes = new Uint8Array(await archived.json() as number[]);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected.operation);

  } finally { await mf.dispose(); }
}, 60_000);

test.runIf(process.env.SYNC_CHUNK_WRITER === '1')('inline threshold and first chunked byte preserve exact operation bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sync-operation-boundary-'));
  let mf = await setupMiniflare({record: false, persistPath: directory, holdAlarms: true});
  const id = 'operation-boundary';
  try {
    const user = await createTestUser(mf, id);
    const content = randomBytes(500_000).toString('base64');
    for (const target of [262144, 262145, 524288, 524289]) {
      const seed = user.doc.export({mode: 'snapshot'});
      const from = user.doc.version();
      let length = target - 200;
      let update = new Uint8Array();
      for (let attempt = 0; attempt < 8; attempt++) {
        const local = new LoroDoc();
        local.import(seed);
        local.setPeerId(user.doc.peerId);
        local.getMap('boundary').set(String(target), content.slice(0, length));
        local.commit();
        update = local.export({mode: 'update', from});
        local.free();
        if (update.length === target) break;
        length += target - update.length;
      }
      expect(update.length).toBe(target);
      user.doc.import(update);
      user.send(FromPeer.fromPeerUpdate({updates: [update], id: String(target)}).encode());
      const ack = await user.readNextMessage();
      expect(ack.isRemoteUpdateAck() && ack.value.id).toBe(String(target));
    }
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = namespace.get(namespace.idFromName(id));
    const dump = await (await stub.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
    const rows = dump.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'));
    expect(rows.length).toBe(4);
    expect(rows.some(([, value]) => Array.isArray(value) && value.length === 2 && value[0] === 0x53430001 && Buffer.from((value[1] as {bytes_b64: string}).bytes_b64, 'base64').length === 524288)).toBe(true);
    const physical = dump.kv.filter(([key]) => key.startsWith('operation-chunks/o/')).map(([, value]) =>
      Buffer.from((value as {bytes_b64: string}).bytes_b64, 'base64').length);
    expect(physical.sort((a, b) => a - b)).toEqual([1, 262144, 262144]);
    user.getWebSocket().close();
    await mf.dispose();
    mf = await setupMiniflare({record: false, persistPath: directory, migrate: false, holdAlarms: true});
    const coldNamespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const cold = coldNamespace.get(coldNamespace.idFromName(id));
    const response = await cold.fetch(`http://localhost/document/${id}/snapshot`, {
      headers: {authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}`},
    });
    expect(response.status).toBe(200);
    const restored = new LoroDoc();
    restored.import(new Uint8Array(await response.arrayBuffer()));
    expect(restored.toJSON()).toEqual(user.doc.toJSON());
    expect(restored.oplogVersion().toJSON()).toEqual(user.doc.oplogVersion().toJSON());
    restored.free();
  } finally {
    await mf.dispose();
    await rm(directory, {recursive: true, force: true});
  }
}, 60_000);

test.runIf(process.env.SYNC_CHUNK_WRITER === '1')('cold archive timestamp reuse removes the previous chunk set', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sync-archive-reuse-'));
  const fixedWallTime = Date.now();
  const options = {record: false, persistPath: directory, holdAlarms: true, fixedWallTime};
  let mf = await setupMiniflare(options);
  const id = 'archive-clock-reuse';
  try {
    const user = await createTestUser(mf, id);
    user.doc.getMap('large').set('value', randomBytes(600_000).toString('base64'));
    user.doc.commit();
    user.send(FromPeer.fromPeerUpdate({updates: [user.doc.export({mode: 'update'})], id: 'first'}).encode());
    expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = namespace.get(namespace.idFromName(id));
    await stub.fetch('http://sync-test/__sync_test_flush_alarm');
    const stored = await (await stub.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
    const archived = stored.kv.filter(([key]) => key.startsWith('a/'));
    expect(archived.length).toBe(1);
    expect(stored.kv.some(([key]) => key.startsWith('operation-chunks/a/'))).toBe(true);
    expect(stored.kv.some(([key]) => key === 'o/!operation-chunks-v1')).toBe(true);
    expect(stored.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'))).toEqual([]);
    user.getWebSocket().close();
    await mf.dispose();
    mf = await setupMiniflare({...options, migrate: false});
    const fresh = await createTestUser(mf, id);
    const from = fresh.doc.version();
    fresh.doc.getText('content').push('new small operation');
    fresh.doc.commit();
    const delta = fresh.doc.export({mode: 'update', from});
    expect(delta.length).toBeLessThan(524288);
    fresh.send(FromPeer.fromPeerUpdate({updates: [delta], id: 'reused'}).encode());
    expect((await fresh.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    const coldNamespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const cold = coldNamespace.get(coldNamespace.idFromName(id));
    const replaced = await (await cold.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
    const rows = replaced.kv.filter(([key]) => key.startsWith('a/'));
    // The unchanged legacy timestamp/counter allocator really reused the ID.
    expect(rows.map(([key]) => key)).toEqual(archived.map(([key]) => key));
    expect(Array.isArray(rows[0][1])).toBe(true);
    expect(replaced.kv.filter(([key]) => key.startsWith('operation-chunks/a/'))).toEqual([]);
    expect(fresh.doc.getMap('large').get('value')).toBe(user.doc.getMap('large').get('value'));
    expect(fresh.getState()).toBe('new small operation');
    fresh.getWebSocket().close();
  } finally {
    await mf.dispose();
    await rm(directory, {recursive: true, force: true});
  }
}, 60_000);
