import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoroDoc } from 'loro-crdt';
import { expect, test } from 'vitest';
import { createTestUser, getTokenForDocument, setupMiniflare } from './utils';

test.each(['legacy', 'current', 'both', 'bad-legacy', 'bad-current'])('cold metadata reader handles %s without rewriting history', async (format) => {
  const persistPath = await mkdtemp(join(tmpdir(), 'sync-reader-debt-'));
  const options = { persistPath, workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true };
  let mf = await setupMiniflare(options);
  try {
    const id = 'fanout-metadata-format';
    const user = await createTestUser(mf, id);
    user.makeChange('stable'); expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    const expected = user.doc.toJSON(), vv = user.doc.oplogVersion().toJSON();
    const future = new LoroDoc(); future.import(user.doc.export({ mode: 'snapshot' }));
    future.getText('content').push('future'); future.commit();
    const valid = [...Buffer.from(JSON.stringify({ base: [...user.doc.oplogVersion().encode()], required: [...future.oplogVersion().encode()] }))];
    const keys = format === 'legacy' ? ['o/~fanout'] : format === 'current' ? ['SYNC_FANOUT_DEBT'] : ['o/~fanout', 'SYNC_FANOUT_DEBT'];
    const rows = keys.map(key => ({ key, bytes: (format === 'bad-legacy' && key === 'o/~fanout') || (format === 'bad-current' && key === 'SYNC_FANOUT_DEBT') ? [...Buffer.from('invalid-debt')] : valid }));
    let ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION'); let stub = ns.get(ns.idFromName(id));
    expect((await stub.fetch('http://sync-test/__reader_test_seed', { method: 'POST', body: JSON.stringify(rows) })).status).toBe(204);
    const before = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { history: unknown[] };
    user.getWebSocket().close(); await mf.dispose();
    mf = await setupMiniflare({ ...options, migrate: false });
    ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION'); stub = ns.get(ns.idFromName(id));
    const response = await stub.fetch(`http://localhost/document/${id}/snapshot`, {
      headers: { authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}` },
    });
    expect(response.status).toBe(format.startsWith('bad-') ? 500 : 200);
    if (!format.startsWith('bad-')) {
      const loaded = new LoroDoc(); loaded.import(new Uint8Array(await response.arrayBuffer()));
      expect(loaded.toJSON()).toEqual(expected); expect(loaded.oplogVersion().toJSON()).toEqual(vv);
    }
    const after = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { history: unknown[] };
    expect(after.history).toEqual(before.history);
  } finally { await mf.dispose(); }
}, 30_000);
