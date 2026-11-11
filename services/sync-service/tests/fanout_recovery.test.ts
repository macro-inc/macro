import { expect, test, assert } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FromPeer } from '../bebop/generated/schema';
import { createTestUser, getTokenForDocument, setupMiniflare } from './utils';

type User = Awaited<ReturnType<typeof createTestUser>>;
function history(user: User, field: string, text: string) {
  const from = user.doc.oplogVersion();
  user.doc.getText(field).push(text); user.doc.commit();
  const parent = user.doc.export({ mode: 'update', from });
  const middle = user.doc.oplogVersion();
  user.doc.getText(field).push('-child'); user.doc.commit();
  return { parent, child: user.doc.export({ mode: 'update', from: middle }) };
}
function send(user: User, bytes: Uint8Array, id: string) {
  user.send(FromPeer.fromPeerUpdate({ updates: [bytes], id }).encode());
}
async function ack(user: User) { expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true); }
async function update(user: User, pending = false) {
  const message = await user.readNextMessage(); assert(message.isRemoteUpdate());
  if (pending) user.doc.import(message.value.update); else user.import(message.value.update);
}

test.each(['o/', 'a/'])('failed parent write at %s retains debt and retries through the real cold loader', async (prefix) => {
  const mf = await setupMiniflare({ workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true });
  try {
    const id = 'fanout-parent-failure';
    const writer = await createTestUser(mf, id);
    const { parent, child } = history(writer, 'content', 'parent');
    send(writer, child, 'child'); await ack(writer);
    const reader = await createTestUser(mf, id);
    const ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = ns.get(ns.idFromName(id));
    expect((await stub.fetch('http://sync-test/__reader_test_fault', {
      method: 'POST', body: JSON.stringify({ method: 'put', prefix }),
    })).status).toBe(204);
    send(writer, parent, 'failed-parent'); writer.send('ping');
    // An ordered callback barrier: an ACK here would fail the assertion.
    expect(await writer.connection.waitForNextMessage()).toBe('pong');
    const dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(dump.keys).toContain('SYNC_FANOUT_DEBT');
    const response = await stub.fetch(`http://localhost/document/${id}/snapshot`, {
      headers: { authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}` },
    });
    expect(response.status).toBe(200);
    const { LoroDoc } = await import('loro-crdt');
    const durable = new LoroDoc(); durable.import(new Uint8Array(await response.arrayBuffer()));
    expect(durable.getText('content').toString()).toBe(prefix === 'o/' ? '' : 'parent-child');
    send(writer, parent, 'retried-parent'); await ack(writer);
    await update(reader); await update(reader);
    expect(reader.getState()).toBe('parent-child');
    expect(reader.doc.oplogVersion().toJSON()).toEqual(writer.doc.oplogVersion().toJSON());
    const after = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(after.keys).not.toContain('SYNC_FANOUT_DEBT');
    writer.getWebSocket().close(); reader.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);

test('independent durable progress is delivered and snapshotted while earlier missing-parent debt stays retained', async () => {
  const mf = await setupMiniflare({ workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true });
  try {
    const id = 'fanout-independent-progress';
    const a = await createTestUser(mf, id), b = await createTestUser(mf, id);
    const first = history(a, 'first', 'one'), second = history(b, 'second', 'two');
    send(a, first.child, 'a-child'); await ack(a); await update(b, true);
    const reader = await createTestUser(mf, id);
    const ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = ns.get(ns.idFromName(id));
    await stub.fetch('http://sync-test/__reader_test_fault', {
      method: 'POST', body: JSON.stringify({ method: 'put', prefix: 'o/' }),
    });
    send(a, first.parent, 'a-parent-failed'); a.send('ping');
    expect(await a.connection.waitForNextMessage()).toBe('pong');
    send(b, second.child, 'b-child'); await ack(b); await update(reader, true);
    expect(reader.doc.getText('second').toString()).toBe('');
    send(b, second.parent, 'b-parent'); await ack(b);
    await update(reader); await update(reader);
    expect(reader.doc.getText('second').toString()).toBe('two-child');
    expect(reader.doc.getText('first').toString()).toBe('');
    let dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(dump.keys).toContain('SYNC_FANOUT_DEBT');
    expect((await stub.fetch('http://sync-test/__reader_test_alarm')).status).toBe(200);
    dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(dump.keys.filter(key => key.startsWith('o/') && !key.startsWith('o/!')).length).toBe(1);
    send(a, first.parent, 'a-parent-retried');
    // Three earlier B frames precede A's retry ACK in the same socket FIFO.
    for (let i = 0; i < 3; i++) await update(a);
    await ack(a);
    await update(reader); await update(reader);
    expect(reader.doc.getText('first').toString()).toBe('one-child');
    expect(reader.doc.getText('second').toString()).toBe('two-child');
    dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(dump.keys).not.toContain('SYNC_FANOUT_DEBT');
    a.getWebSocket().close(); b.getWebSocket().close(); reader.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);

test('ordinary updates have no fanout marker reads or writes after cold restore', async () => {
  const mf = await setupMiniflare({ workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true });
  try {
    const id = 'ordinary-fanout-io';
    const user = await createTestUser(mf, id);
    const ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = ns.get(ns.idFromName(id));
    user.send('ping'); expect(await user.connection.waitForNextMessage()).toBe('pong');
    await stub.fetch('http://sync-test/__reader_test_events_reset');
    user.makeChange('ordinary'); await ack(user);
    const dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { events: [string, string][] };
    expect(dump.events.filter(([, key]) => key === 'SYNC_FANOUT_DEBT' || key === 'o/~fanout')).toEqual([]);
    user.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);

test('one failed receiver cannot starve later healthy receivers; alarm retries retained debt idempotently', async () => {
  const mf = await setupMiniflare({ workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true });
  try {
    const id = 'fanout-failed-receiver';
    const writer = await createTestUser(mf, id);
    const { parent, child } = history(writer, 'content', 'parent');
    send(writer, child, 'child'); await ack(writer);
    const failed = await createTestUser(mf, id), healthy = await createTestUser(mf, id);
    const ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    const stub = ns.get(ns.idFromName(id));
    let dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[]; sockets: string[] };
    expect(dump.sockets).toHaveLength(3);
    await stub.fetch('http://sync-test/__reader_test_send_failure', {
      method: 'POST', body: JSON.stringify({ id: dump.sockets[1], nth: 2 }),
    });
    send(writer, parent, 'parent'); await ack(writer);
    await update(failed); // ordinary parent succeeds; resolved-delta send fails
    await update(healthy); await update(healthy);
    expect(healthy.getState()).toBe('parent-child'); expect(failed.getState()).toBe('parent');
    dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[]; sockets: string[] };
    expect(dump.keys).toContain('SYNC_FANOUT_DEBT');
    const vv = healthy.doc.oplogVersion().toJSON();
    expect((await stub.fetch('http://sync-test/__reader_test_alarm')).status).toBe(200);
    await update(failed); await update(healthy);
    expect(failed.getState()).toBe('parent-child'); expect(healthy.getState()).toBe('parent-child');
    expect(healthy.doc.oplogVersion().toJSON()).toEqual(vv);
    dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[]; sockets: string[] };
    expect(dump.keys).not.toContain('SYNC_FANOUT_DEBT');
    writer.getWebSocket().close(); failed.getWebSocket().close(); healthy.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);

test('snapshot GC retains an acknowledged unresolved child through a real runtime restart', async () => {
  const persistPath = await mkdtemp(join(tmpdir(), 'sync-reader-pending-gc-'));
  const options = { persistPath, workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true };
  let mf = await setupMiniflare(options);
  try {
    const id = 'acknowledged-pending-gc';
    const writer = await createTestUser(mf, id);
    const { parent, child } = history(writer, 'content', 'parent');
    send(writer, child, 'child'); await ack(writer);
    let ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    let stub = ns.get(ns.idFromName(id));
    expect((await stub.fetch('http://sync-test/__reader_test_alarm')).status).toBe(200);
    let dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(dump.keys.filter(key => key.startsWith('o/') && !key.startsWith('o/!'))).toHaveLength(1);
    writer.getWebSocket().close(); await mf.dispose();
    mf = await setupMiniflare({ ...options, migrate: false });
    const recovered = await createTestUser(mf, id);
    expect(recovered.getState()).toBe('');
    send(recovered, parent, 'parent'); await ack(recovered); await update(recovered);
    expect(recovered.getState()).toBe('parent-child');
    expect(recovered.doc.oplogVersion().toJSON()).toEqual(writer.doc.oplogVersion().toJSON());
    ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION'); stub = ns.get(ns.idFromName(id));
    dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(dump.keys).not.toContain('SYNC_FANOUT_DEBT');
    recovered.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);

test('cold retry after successful fanout but failed marker deletion is idempotent', async () => {
  const persistPath = await mkdtemp(join(tmpdir(), 'sync-reader-fanout-clear-'));
  const options = { persistPath, workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true };
  let mf = await setupMiniflare(options);
  try {
    const id = 'fanout-clear-retry';
    const writer = await createTestUser(mf, id);
    const { parent, child } = history(writer, 'content', 'parent');
    send(writer, child, 'child'); await ack(writer);
    const reader = await createTestUser(mf, id);
    let ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION'); let stub = ns.get(ns.idFromName(id));
    await stub.fetch('http://sync-test/__reader_test_fault', {
      method: 'POST', body: JSON.stringify({ method: 'delete', prefix: 'SYNC_FANOUT_DEBT' }),
    });
    send(writer, parent, 'parent'); await ack(writer);
    await update(reader); await update(reader); await update(writer);
    expect(reader.getState()).toBe('parent-child');
    const vv = reader.doc.oplogVersion().toJSON();
    let dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(dump.keys).toContain('SYNC_FANOUT_DEBT');
    writer.getWebSocket().close(); reader.getWebSocket().close(); await mf.dispose();
    mf = await setupMiniflare({ ...options, migrate: false });
    const recovered = await createTestUser(mf, id);
    ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION'); stub = ns.get(ns.idFromName(id));
    expect((await stub.fetch('http://sync-test/__reader_test_alarm')).status).toBe(200);
    await update(recovered);
    expect(recovered.getState()).toBe('parent-child'); expect(recovered.doc.oplogVersion().toJSON()).toEqual(vv);
    dump = await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[] };
    expect(dump.keys).not.toContain('SYNC_FANOUT_DEBT');
    recovered.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);
