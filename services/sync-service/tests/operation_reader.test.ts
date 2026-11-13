import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoroDoc } from 'loro-crdt';
import { expect, test } from 'vitest';
import { FromPeer } from '../bebop/generated/schema';
import { createTestUser, getTokenForDocument, INTERNAL_API_SECRET, setupMiniflare } from './utils';

const CHUNK = 256 * 1024;
const INLINE = 512 * 1024;
const marker = { key: 'o/!operation-chunks-v1', bytes: [...Buffer.from('SYNC_OPERATION_CHUNKS_V1')] };
type Row = { key: string; bytes: number[]; kind?: 'tuple' | 'array'; tag?: number };
function chunked(key: string, bytes: Uint8Array, complete: boolean): Row[] {
  expect(bytes.length).toBeGreaterThan(INLINE);
  const header = Buffer.alloc(63);
  header.set(Buffer.from(`SYNC_OP_CHUNKS${complete ? '\x02' : '\x01'}`));
  header.writeBigUInt64LE(BigInt(bytes.length), 15);
  header.writeBigUInt64LE(BigInt(Math.ceil(bytes.length / CHUNK)), 23);
  header.set(createHash('sha256').update(bytes).digest(), 31);
  return [
    { key, bytes: [...header] },
    ...Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, index) => ({
      key: `operation-chunks/${key}/${index.toString(16).padStart(8, '0')}`,
      bytes: [...bytes.subarray(index * CHUNK, (index + 1) * CHUNK)],
    })),
  ];
}
function variedText(seed: number): string {
  let state = seed;
  const chars = new Uint8Array(850_000);
  for (let i = 0; i < chars.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    chars[i] = 32 + ((state >>> 24) % 95);
  }
  return new TextDecoder().decode(chars);
}
async function readerRuntime() {
  const persistPath = await mkdtemp(join(tmpdir(), 'sync-reader-first-'));
  const options = { workerScriptPath: './tests/reader-worker.mjs', holdAlarms: true, persistPath };
  let current = await setupMiniflare(options);
  // The production-pinned workerd predates unsafe.evict. Restart the actual
  // runtime over the same physical store instead of simulating cache deletion.
  const mf = new Proxy(current, { get: (_target, key) => {
    const value = Reflect.get(current, key, current);
    return typeof value === 'function' ? value.bind(current) : value;
  } });
  return { mf, cold: async () => {
    await current.dispose();
    current = await setupMiniflare({ ...options, migrate: false });
  } };
}
async function control(mf: Awaited<ReturnType<typeof setupMiniflare>>, id: string, cold: () => Promise<void>) {
  const ns = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
  const stub = { fetch: async (...args: Parameters<ReturnType<typeof ns.get>['fetch']>) => {
    const currentNs = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
    return currentNs.get(currentNs.idFromName(id)).fetch(...args);
  } };
  return {
    seed: async (rows: Row[]) => expect((await stub.fetch('http://sync-test/__reader_test_seed', {
      method: 'POST', body: JSON.stringify(rows),
    })).status).toBe(204),
    dump: async () => await (await stub.fetch('http://sync-test/__reader_test_dump')).json() as { keys: string[]; events: [string, string][] },
    cold,
    snapshot: () => stub.fetch(`http://localhost/document/${id}/snapshot`, {
      headers: { authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}` },
    }),
    alarm: () => stub.fetch('http://sync-test/__reader_test_alarm'),
  };
}

// No writer feature exists in this build: exact future-format values are seeded
// through an external test adapter, never through deployed HTTP handlers.
test('reader-only worker recovers mixed legacy, tuple and both manifest versions; GC retains incomplete archives', async () => {
  const { mf, cold } = await readerRuntime();
  try {
    const id = 'mixed-operation-reader';
    const user = await createTestUser(mf, id).catch(error => { throw new Error('initial-small-join: ' + String(error)); });
    const c = await control(mf, id, cold);
    const rows: Row[] = [marker];
    const expectedArchives = new Map<string, number[]>();
    for (const [key, format, text] of [
      ['legacy', 'array', 'legacy'], ['inline', 'tuple', '-inline'],
      ['incomplete', 'chunks1', variedText(17)], ['complete', 'chunks2', variedText(29)],
    ] as const) {
      const from = user.doc.oplogVersion();
      // Physical reader/GC conformance needs large byte values, not millions
      // of text operations. The separately retained text-heavy timing control
      // remains strict and is not a performance-admission claim for this test.
      if (format.startsWith('chunks')) user.doc.getMap('payloads').set(key, text);
      else user.doc.getText('content').push(text);
      user.doc.commit();
      const bytes = user.doc.export({ mode: 'update', from });
      expectedArchives.set(`a/${key}`, [...bytes]);
      if (format.startsWith('chunks')) {
        rows.push(...chunked(`o/${key}`, bytes, format === 'chunks2'));
        rows.push(...chunked(`a/${key}`, bytes, false));
      } else {
        rows.push({ key: `o/${key}`, bytes: [...bytes], kind: format === 'tuple' ? 'tuple' : 'array' });
        rows.push({ key: `a/${key}`, bytes: [...bytes], kind: 'array' });
      }
    }
    rows.push({ key: 'o/!archive-status-v1/incomplete', bytes: [...Buffer.from(JSON.stringify({ state: 'incomplete', attribution: null }))] });
    rows.push({ key: 'o/!archive-status-v1/legacy', bytes: [...Buffer.from(JSON.stringify({ state: 'complete' }))] });
    await c.seed(rows);
    await c.cold();
    const response = await c.snapshot();
    expect(response.status).toBe(200);
    const loaded = new LoroDoc();
    loaded.import(new Uint8Array(await response.arrayBuffer()));
    expect(loaded.toJSON()).toEqual(user.doc.toJSON());
    expect(loaded.oplogVersion().toJSON()).toEqual(user.doc.oplogVersion().toJSON());
    // Archive reads must resolve the same logical bytes, not expose manifests.
    const archive = await mf.dispatchFetch(`http://localhost/document/${id}/debug_do_kv_list/a`, {
      headers: { 'x-internal-auth-key': INTERNAL_API_SECRET },
    });
    expect(archive.status).toBe(200);
    const archived = await archive.json() as [string, number[]][];
    for (const [key, expected] of expectedArchives) {
      expect(archived.find(([stored]) => stored === key)?.[1]).toEqual(expected);
    }
    const writer = await createTestUser(mf, id).catch(error => { throw new Error('restored-large-join: ' + String(error)); });
    const from = writer.doc.oplogVersion();
    writer.doc.getText('content').push('-tail'); writer.doc.commit();
    // The generic small-fixture helper exports all retained history. A shallow
    // root can retain a large map operation, so send the actual new delta here.
    const tail = writer.doc.export({ mode: 'update', from });
    expect(tail.length).toBeLessThan(1024);
    writer.send(FromPeer.fromPeerUpdate({ updates: [tail], id: 'gc-tail' }).encode());
    expect((await writer.readNextMessage().catch(error => { throw new Error('restored-tail-ACK: ' + String(error)); })).isRemoteUpdateAck()).toBe(true);
    expect((await c.alarm()).status).toBe(200);
    const after = await c.dump();
    expect(after.keys).toContain('o/incomplete');
    expect(after.keys).toContain('o/!archive-status-v1/incomplete');
    expect(after.keys.some(key => key.startsWith('operation-chunks/o/incomplete/'))).toBe(true);
    expect(after.keys).not.toContain('o/complete');
    expect(after.keys).not.toContain('o/legacy');
    expect(after.keys).not.toContain('o/!archive-status-v1/legacy');
    expect(after.keys.some(key => key.startsWith('operation-chunks/o/complete/'))).toBe(false);
    expect(after.keys.some(key => key.startsWith('operation-chunks/a/complete/'))).toBe(true);
    user.getWebSocket().close(); writer.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 90_000);

test.each(['missing', 'checksum', 'manifest-version', 'tuple-version', 'archive-status'])('invalid %s fails cold load without deleting durable rows', async (failure) => {
  const { mf, cold } = await readerRuntime();
  try {
    const id = 'invalid-operation-reader';
    const user = await createTestUser(mf, id);
    const c = await control(mf, id, cold);
    let rows: Row[];
    if (failure === 'tuple-version') rows = [{ key: 'o/invalid', bytes: [1, 2], kind: 'tuple', tag: 0x53430002 }];
    else if (failure === 'archive-status') rows = [{ key: 'o/!archive-status-v1/invalid', bytes: [...Buffer.from('{"state":"future"}')] }];
    else {
      rows = chunked('o/invalid', new Uint8Array(INLINE + 1).fill(7), false);
      if (failure === 'missing') rows.pop();
      if (failure === 'checksum') rows[1].bytes[0] ^= 1;
      if (failure === 'manifest-version') rows[0].bytes[14] = 99;
    }
    await c.seed(rows);
    const before = (await c.dump()).keys;
    await c.cold();
    expect((await c.snapshot()).status).toBe(500);
    expect((await c.dump()).keys).toEqual(before);
    user.getWebSocket().close();
  } finally { await mf.dispose(); }
}, 30_000);
