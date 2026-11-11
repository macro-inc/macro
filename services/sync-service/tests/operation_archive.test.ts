import { expect, test } from 'vitest';
import { FromPeer } from '../../../crates/sync_protocol/bebop/generated/schema';
import { abortObjectBetweenMessages, createTestUser, setupMiniflare } from './utils';

test.runIf(process.env.SYNC_CHUNK_WRITER === '1')('modern duplicate receipts require no new writes, including after cold replay', async () => {
  const mf = await setupMiniflare({record: false, holdAlarms: true});
  try {
    const id = 'archive-complete-duplicate';
    const user = await createTestUser(mf, id);
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = namespace.get(namespace.idFromName(id));
    user.doc.getText('content').push('durable');
    user.doc.commit();
    const update = user.doc.export({mode: 'update'});
    const atomicProbe = await (await stub.fetch('http://sync-test/__sync_test_atomic_batch_probe')).json() as {error: string; first: string; largeMissing: boolean};
    expect(atomicProbe.error).toContain('SQLITE_TOOBIG');
    expect(atomicProbe.first).toBe('old');
    expect(atomicProbe.largeMissing).toBe(true);
    const beforeAppend = await (await stub.fetch('http://sync-test/__sync_test_message_timing')).json() as {transactions: number; atomicBatches: number};
    user.send(FromPeer.fromPeerUpdate({updates: [update], id: 'first'}).encode());
    const first = await user.readNextMessage();
    expect(first.isRemoteUpdateAck() && first.value.id).toBe('first');
    const afterAppend = await (await stub.fetch('http://sync-test/__sync_test_message_timing')).json() as {transactions: number; atomicBatches: number};
    expect(afterAppend.transactions + afterAppend.atomicBatches - beforeAppend.transactions - beforeAppend.atomicBatches).toBe(1);
    for (const cold of [false, true]) {
      if (cold) await abortObjectBetweenMessages(stub);
      const before = await (await stub.fetch('http://sync-test/__sync_test_operation_archive')).json();
      user.send(FromPeer.fromPeerUpdate({updates: [update], id: 'duplicate'}).encode());
      const duplicate = await user.readNextMessage();
      expect(duplicate.isRemoteUpdateAck() && duplicate.value.id).toBe('duplicate');
      expect(await (await stub.fetch('http://sync-test/__sync_test_operation_archive')).json()).toEqual(before);
    }
    const dump = await (await stub.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
    expect(dump.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'))).toHaveLength(1);
    expect(dump.kv.filter(([key]) => key.startsWith('a/'))).toHaveLength(1);
    expect(dump.kv.filter(([key]) => key.startsWith('o/!archive-status-v1/'))).toHaveLength(0);
    user.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);

test.runIf(process.env.SYNC_CHUNK_WRITER === '1')('pending success with archive failure repairs the original archive after restart before ACK', async () => {
  const mf = await setupMiniflare({record: false, holdAlarms: true});
  try {
    const id = 'archive-failure-recovery';
    const user = await createTestUser(mf, id);
    const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = namespace.get(namespace.idFromName(id));
    user.doc.getText('content').push('retain me');
    user.doc.commit();
    const update = user.doc.export({mode: 'update'});
    const message = FromPeer.fromPeerUpdate({updates: [update], id: 'repair'}).encode();
    await stub.fetch('http://sync-test/__sync_test_operation_archive?fail=1');
    user.send(message);
    user.send('ping');
    expect(await user.waitForNextMessage()).toBe('pong');
    const failed = await (await stub.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
    const pending = failed.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'));
    expect(pending).toHaveLength(1);
    expect(failed.kv.filter(([key]) => key.startsWith('a/'))).toEqual([]);
    await abortObjectBetweenMessages(stub);
    user.send(message);
    const receipt = await user.readNextMessage();
    expect(receipt.isRemoteUpdateAck() && receipt.value.id).toBe('repair');
    const repaired = await (await stub.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
    expect(repaired.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'))).toEqual(pending);
    expect(repaired.kv.filter(([key]) => key.startsWith('a/')).map(([key, value]) => [key.replace(/^a\//, 'o/'), value])).toEqual(pending);
    const before = await (await stub.fetch('http://sync-test/__sync_test_operation_archive')).json();
    user.send(message);
    expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
    expect(await (await stub.fetch('http://sync-test/__sync_test_operation_archive')).json()).toEqual(before);
    user.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);

for (const archive of ['present', 'missing']) {
  test.runIf(process.env.SYNC_CHUNK_WRITER === '1')(`legacy row with archive ${archive} repairs once without a second operation set`, async () => {
    const mf = await setupMiniflare({record: false, holdAlarms: true});
    try {
      const id = `archive-legacy-${archive}`;
      const user = await createTestUser(mf, id);
      const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
      const stub = namespace.get(namespace.idFromName(id));
      user.doc.getText('content').push('legacy');
      user.doc.commit();
      const update = user.doc.export({mode: 'update'});
      const message = FromPeer.fromPeerUpdate({updates: [update], id: 'legacy'}).encode();
      user.send(message);
      expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
      await stub.fetch(`http://sync-test/__sync_test_operation_archive?legacy=${archive}`);
      await abortObjectBetweenMessages(stub);
      user.send(message);
      expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
      expect(await (await stub.fetch('http://sync-test/__sync_test_operation_archive')).json()).toEqual({pending: 0, archive: 1, status: 1});
      const repaired = await (await stub.fetch('http://sync-test/__sync_test_dump')).json() as {kv: [string, unknown][]};
      expect(repaired.kv.filter(([key]) => key.startsWith('a/'))).toHaveLength(1);
      expect(repaired.kv.filter(([key]) => key.startsWith('o/') && !key.startsWith('o/!'))).toHaveLength(1);
      await abortObjectBetweenMessages(stub);
      user.send(message);
      expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
      expect(await (await stub.fetch('http://sync-test/__sync_test_operation_archive')).json()).toEqual({pending: 0, archive: 0, status: 0});
      user.getWebSocket().close();
    } finally { await mf.dispose(); }
  }, 30_000);
}
