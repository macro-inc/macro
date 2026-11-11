import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LoroDoc } from 'loro-crdt';
import { expect, test } from 'vitest';
import { createTestUser, getTokenForDocument, setupMiniflare } from './utils';

const retained = process.env.SYNC_ARCHIVE_READER_STORE;
test.runIf(process.env.SYNC_CHUNK_WRITER === '1')('persist all archive states for the reader-only rollback build', async () => {
  const directory = retained ?? await mkdtemp(join(tmpdir(), 'sync-archive-reader-'));
  if (retained) await mkdir(directory);
  const mf = await setupMiniflare({record: false, persistPath: directory, holdAlarms: true});
  try {
    const user = await createTestUser(mf, 'archive-reader-states');
    for (const text of ['legacy', ' incomplete', ' complete']) {
      user.makeChange(text);
      expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    }
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = namespace.get(namespace.idFromName('archive-reader-states'));
    await stub.fetch('http://sync-test/__sync_test_operation_archive?seedStates=1');
    await writeFile(join(directory, 'archive-expected.json'), JSON.stringify({state: user.doc.toJSON(), vv: [...user.doc.oplogVersion().toJSON()]}));
    user.getWebSocket().close();
  } finally {
    await mf.dispose();
    if (!retained) await rm(directory, {recursive: true, force: true});
  }
}, 30_000);

test.runIf(Boolean(retained) && process.env.SYNC_CHUNK_WRITER !== '1')('writer-OFF rollback reads legacy, incomplete and complete status written by writer-ON', async () => {
  const expected = JSON.parse(await readFile(join(retained!, 'archive-expected.json'), 'utf8'));
  const mf = await setupMiniflare({record: false, persistPath: retained, migrate: false, holdAlarms: true});
  try {
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = namespace.get(namespace.idFromName('archive-reader-states'));
    const response = await stub.fetch('http://localhost/document/archive-reader-states/snapshot', {
      headers: {authorization: `Bearer ${getTokenForDocument('archive-reader-states', 'fixture-user', 'owner')}`},
    });
    expect(response.status).toBe(200);
    const doc = new LoroDoc();
    doc.import(new Uint8Array(await response.arrayBuffer()));
    expect(doc.toJSON()).toEqual(expected.state);
    expect([...doc.oplogVersion().toJSON()]).toEqual(expected.vv);
    doc.free();
    const dump = await (await stub.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
    expect(dump.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'))).toHaveLength(3);
    const statuses = dump.kv.filter(([key]) => key.startsWith('o/!archive-status-v1/')).map(([, bytes]) => JSON.parse(Buffer.from(bytes as number[]).toString()));
    expect(statuses).toEqual([{state: 'incomplete', attribution: null}]);
    expect(dump.kv.some(([key, value]) => key.startsWith('o/') && !key.startsWith('o/!') && Array.isArray(value) && value.length === 2 && value[0] === 0x53430001 && typeof (value[1] as {bytes_b64: string}).bytes_b64 === 'string')).toBe(true);
    expect(await (await stub.fetch('http://sync-test/__sync_test_operation_archive')).json()).toEqual({pending: 0, archive: 0, status: 0});
  } finally { await mf.dispose(); }
}, 30_000);
