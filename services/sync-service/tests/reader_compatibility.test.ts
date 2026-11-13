import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoroDoc } from 'loro-crdt';
import { expect, test } from 'vitest';
import { createTestUser, getTokenForDocument, setupMiniflare } from './utils';

// External adapters must import immutable source-bound builds. No downloaded or
// guessed production artifact is accepted, and these builds are never deployed.
test.runIf(Boolean(process.env.SYNC_LEGACY_READER_ADAPTER))('production-tag reader preserves legacy history and ignores outside-prefix debt', async () => {
  const persistPath = await mkdtemp(join(tmpdir(), 'sync-reader-rollback-'));
  const id = 'legacy-rollback';
  let mf = await setupMiniflare({ persistPath, workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true });
  try {
    const user = await createTestUser(mf, id);
    user.makeChange('rollback-safe-history');
    expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    const expected = user.doc.toJSON(), vv = user.doc.oplogVersion().toJSON();
    const future = new LoroDoc(); future.import(user.doc.export({ mode: 'snapshot' }));
    future.getText('content').push('-future'); future.commit();
    const debt = [...Buffer.from(JSON.stringify({ base: [...user.doc.oplogVersion().encode()], required: [...future.oplogVersion().encode()] }))];
    let ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    await ns.get(ns.idFromName(id)).fetch('http://sync-test/__reader_test_seed', {
      method: 'POST', body: JSON.stringify([{ key: 'SYNC_FANOUT_DEBT', bytes: debt }]),
    });
    user.getWebSocket().close(); await mf.dispose();
    mf = await setupMiniflare({ persistPath, migrate: false, holdAlarms: true, workerScriptPath: process.env.SYNC_LEGACY_READER_ADAPTER });
    ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = ns.get(ns.idFromName(id));
    const response = await stub.fetch(`http://localhost/document/${id}/snapshot`, {
      headers: { authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}` },
    });
    expect(response.status).toBe(200);
    const loaded = new LoroDoc(); loaded.import(new Uint8Array(await response.arrayBuffer()));
    expect(loaded.toJSON()).toEqual(expected); expect(loaded.oplogVersion().toJSON()).toEqual(vv);
    expect(await (await stub.fetch('http://sync-test/__reader_test_value?key=SYNC_FANOUT_DEBT')).json()).toEqual(debt);
  } finally { await mf.dispose(); }
}, 60_000);

test.runIf(Boolean(process.env.SYNC_FUTURE_WRITER_ADAPTER))('reader-only build recovers an actual activated-writer append from the same physical store', async () => {
  const persistPath = await mkdtemp(join(tmpdir(), 'sync-reader-writer-'));
  const id = 'activated-writer-reader';
  let mf = await setupMiniflare({ persistPath, workerScriptPath: process.env.SYNC_FUTURE_WRITER_ADAPTER, holdAlarms: true });
  try {
    const user = await createTestUser(mf, id);
    let seed = 37;
    const chars = new Uint8Array(850_000);
    for (let i = 0; i < chars.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; chars[i] = 32 + ((seed >>> 24) % 95); }
    user.makeChange(new TextDecoder().decode(chars));
    expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    const expected = user.doc.toJSON(), vv = user.doc.oplogVersion().toJSON();
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const writerDump = await (await namespace.get(namespace.idFromName(id)).fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[]; history: unknown[] };
    expect(writerDump.keys).toContain('o/!operation-chunks-v1');
    expect(writerDump.keys.some(key => key.startsWith('operation-chunks/o/'))).toBe(true);
    user.getWebSocket().close(); await mf.dispose();
    mf = await setupMiniflare({ persistPath, migrate: false, holdAlarms: true, workerScriptPath: './tests/reader-worker.mjs' });
    const reader = await createTestUser(mf, id);
    expect(reader.doc.toJSON()).toEqual(expected); expect(reader.doc.oplogVersion().toJSON()).toEqual(vv);
    reader.getWebSocket().close();
    if (process.env.SYNC_LEGACY_READER_ADAPTER) {
      // This is the forbidden rollback, tested only on our isolated store.
      // The old reader must not be described as format-capable after activation.
      await mf.dispose();
      mf = await setupMiniflare({ persistPath, migrate: false, holdAlarms: true, workerScriptPath: process.env.SYNC_LEGACY_READER_ADAPTER });
      const ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
      const stub = ns.get(ns.idFromName(id));
      const response = await stub.fetch(`http://localhost/document/${id}/snapshot`, {
        headers: { authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}` },
      });
      expect(response.status).toBe(500);
      const after = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[]; history: unknown[] };
      // Connection identities legitimately differ between these processes;
      // every operation/receipt/attribution/chunk byte and format must not.
      expect(after.history).toEqual(writerDump.history);
    }
  } finally { await mf.dispose(); }
}, 90_000);
