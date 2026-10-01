import * as A from '@automerge/automerge';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { AutomergeSession, initializeDocument } from '../client/document';
import { createTestWebSocket, getTokenForDocument, setupMiniflare } from './utils';
import { FromPeer, FromRemote } from '../bebop/generated/schema';

type Content = { text: string; cells: Record<string, string> };
const persistPath = mkdtempSync(join(tmpdir(), 'automerge-native-'));
let mf: Awaited<ReturnType<typeof setupMiniflare>>;
let base: string;
const sessions: AutomergeSession<Content>[] = [];
beforeAll(async () => { mf = await setupMiniflare({ persistPath }); base = (await mf.ready).origin; });
afterAll(async () => { sessions.forEach(peer => peer.dispose()); await mf?.dispose(); rmSync(persistPath, { recursive: true, force: true }); });

async function peer(id: string) {
  const session = new AutomergeSession<Content>({ url: `${base}/document/${id}/connect`, token: () => getTokenForDocument(id, 'native-client', 'edit') });
  sessions.push(session);
  await session.connect();
  return session;
}

async function eventually(check: () => boolean) {
  const end = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() >= end) throw new Error('Native peers did not converge');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('native clients converge concurrent offline edits, copy historical heads and recover after process restart', async () => {
  const id = crypto.randomUUID();
  const seed = A.from<Content>({ text: 'seed 🐺', cells: {} });
  await initializeDocument(`${base}/document/${id}/initialize`, getTokenForDocument(id, 'owner', 'owner'), seed);
  A.free(seed);
  const alice = await peer(id);
  const bob = await peer(id);
  alice.change(draft => { A.splice(draft, ['text'], 0, 0, 'alice '); draft.cells.A1 = 'one'; });
  await alice.flush();
  await eventually(() => bob.doc.text === alice.doc.text);
  const historical = A.getHeads(alice.doc);
  const historicalText = alice.doc.text;
  bob.disconnect();
  bob.change(draft => { A.splice(draft, ['text'], 0, 0, 'offline '); draft.cells.B1 = 'two'; });
  alice.change(draft => { A.splice(draft, ['text'], 0, 0, 'online '); draft.cells.C1 = 'three'; });
  await alice.flush();
  await bob.connect();
  await bob.flush();
  await expect.poll(() => A.getHeads(alice.doc), { timeout: 10_000 }).toEqual(A.getHeads(bob.doc));
  expect(alice.doc).toEqual(bob.doc);
  expect(alice.doc.text).toContain('offline');
  expect(alice.doc.text).toContain('online');
  expect(alice.doc.cells).toEqual({ A1: 'one', B1: 'two', C1: 'three' });

  const copy = crypto.randomUUID();
  const response = await fetch(`${base}/document/${id}/copy`, { method: 'POST', headers: { 'x-internal-auth-key': 'local', 'Content-Type': 'application/json' }, body: JSON.stringify({ target_document_id: copy, version_id: historical }) });
  expect(response.status).toBe(200);
  const copied = await peer(copy);
  expect(copied.doc.text).toBe(historicalText);
  const saved = JSON.parse(JSON.stringify(alice.doc));
  sessions.forEach(session => session.disconnect());
  await mf.dispose();
  mf = await setupMiniflare({ persistPath, migrate: false });
  base = (await mf.ready).origin;
  const restored = await peer(id);
  expect(restored.doc).toEqual(saved);
}, 60_000);

test.each(['disconnect', 'dispose'] as const)('cancels token refresh on %s', async action => {
  let resolveToken!: (token: string) => void;
  const token = new Promise<string>(resolve => { resolveToken = resolve; });
  const sockets = vi.fn();
  vi.stubGlobal('WebSocket', sockets);
  const session = new AutomergeSession<Content>({ url: 'https://localhost/document/cancel/connect', token: () => token });
  try {
    const connection = session.connect();
    session[action]();
    resolveToken('cancelled');
    await expect(connection).rejects.toThrow('Connection cancelled');
    expect(sockets).not.toHaveBeenCalled();
    session.dispose();
    session.dispose();
    await expect(session.connect()).rejects.toThrow('Session is disposed');
  } finally {
    session.dispose();
    vi.unstubAllGlobals();
  }
});

test('persists child-before-parent changes atomically for cold recovery', async () => {
  const id = crypto.randomUUID();
  let doc = A.from<Content>({ text: 'seed', cells: {} });
  await initializeDocument(`${base}/document/${id}/initialize`, getTokenForDocument(id, 'owner', 'owner'), doc);
  const before = A.getHeads(doc);
  doc = A.change(doc, draft => { draft.cells.A1 = 'parent'; });
  const parent = A.saveSince(doc, before);
  const middle = A.getHeads(doc);
  doc = A.change(doc, draft => { draft.cells.A1 = 'child'; });
  const child = A.saveSince(doc, middle);
  const response = await mf.dispatchFetch(`http://localhost/document/${id}/connect?token=${getTokenForDocument(id, 'owner', 'owner')}`, { headers: { Upgrade: 'websocket' } });
  const socket = createTestWebSocket(response.webSocket!);
  response.webSocket!.accept();
  await socket.waitForNextMessage();
  socket.send(FromPeer.fromPeerUpdate({ id: 'reordered-batch', updates: [child, parent] }).encode());
  const ack = FromRemote.decode(new Uint8Array(await socket.waitForNextMessage() as ArrayBuffer));
  expect(ack.isRemoteUpdateAck() && ack.value.id).toBe('reordered-batch');
  socket.getWebSocket().close();
  sessions.forEach(session => session.disconnect());
  await mf.dispose();
  mf = await setupMiniflare({ persistPath, migrate: false });
  base = (await mf.ready).origin;
  const recovered = await peer(id);
  expect(recovered.doc).toEqual(doc);
  A.free(doc);
});
