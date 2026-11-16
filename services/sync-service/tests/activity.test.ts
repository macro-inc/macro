import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { LoroDoc } from 'loro-crdt';
import type { Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { FromPeer, FromRemote, InitializeFromSnapshotRequest } from '../bebop/generated/schema';
import { createTestWebSocket, setupMiniflare } from './utils';

type Editor = { actor: string; on_behalf_of: string | null };
type Notification = { editors: Editor[] };
type DssMode = 'hold_snapshot' | 'hold_notification' | 'fail_notification' | 'legacy';
type HeldRequest = { documentId: string; response: ServerResponse };
type Client = Awaited<ReturnType<typeof connect>>;
let mf: Miniflare;
let server: Server;
const notifications = new Map<string, Notification[]>();
const rawNotifications = new Map<string, Partial<Notification>[]>();
const snapshots = new Map<string, Uint8Array[]>();
const modes = new Map<string, DssMode>();
const heldRequests: HeldRequest[] = [];
const clients: Client[] = [];
const persistPath = mkdtempSync(join(tmpdir(), 'sync-activity-'));

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
    } catch (error) {
      // Disposing Miniflare can cancel an in-flight lifecycle notification.
      if (req.aborted) return;
      throw error;
    }
    const match = req.url?.match(/\/documents\/([^/]+)\/(snapshot|sync-content-updated)$/);
    if (match) {
      const documentId = match[1];
      const kind = match[2] === 'snapshot' ? 'snapshot' : 'notification';
      const body = Buffer.concat(chunks);
      const mode = modes.get(documentId);
      if (kind === 'snapshot') {
        const records = snapshots.get(documentId) ?? [];
        records.push(body);
        snapshots.set(documentId, records);
      } else {
        const parsed = JSON.parse(body.toString()) as Partial<Notification>;
        const rawRecords = rawNotifications.get(documentId) ?? [];
        rawRecords.push(parsed);
        rawNotifications.set(documentId, rawRecords);
        const records = notifications.get(documentId) ?? [];
        records.push({ editors: parsed.editors ?? [] });
        notifications.set(documentId, records);
        if (mode === 'legacy' && 'editors' in parsed) {
          res.writeHead(422).end();
          return;
        }
      }
      if (mode === `hold_${kind}`) {
        heldRequests.push({ documentId, response: res });
        return;
      }
      if (kind === 'notification' && mode === 'fail_notification') {
        res.writeHead(503).end();
        return;
      }
    }
    res.writeHead(200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing mock DSS address');
  mf = await setupMiniflare({ persistPath, dssUrl: `http://127.0.0.1:${address.port}` });
}, 60_000);

afterEach(() => {
  for (const { documentId } of heldRequests) modes.set(documentId, 'fail_notification');
  for (const { response } of heldRequests.splice(0)) response.writeHead(503).end();
  for (const client of clients.splice(0)) {
    if (client.getWebSocket().readyState === 1) client.getWebSocket().close();
    client.doc.free();
  }
});

afterAll(async () => {
  await mf?.dispose();
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  rmSync(persistPath, { recursive: true, force: true });
});

async function seed() {
  const id = crypto.randomUUID();
  const doc = new LoroDoc();
  doc.getText('content').insert(0, 'Original content');
  const response = await mf.dispatchFetch(`http://localhost/document/${id}/initialize`, {
    method: 'POST',
    headers: { 'x-internal-auth-key': 'local' },
    body: InitializeFromSnapshotRequest.encode({ snapshot: doc.export({ mode: 'snapshot' }) }),
  });
  expect(response.status).toBe(200);
  doc.free();
  await expect.poll(() => notifications.get(id), { timeout: 10_000 }).toEqual([{ editors: [] }]);
  return id;
}

function tokenFor(id: string, userId: string | null, actor?: string, access = 'edit') {
  return jwt.sign({ document_id: id, user_id: userId, actor, access_level: access,
    exp: Math.floor(Date.now() / 1000) + 120 }, 'local');
}

async function connect(id: string, userId: string | null, actor?: string, access = 'edit') {
  const token = tokenFor(id, userId, actor, access);
  const response = await mf.dispatchFetch(`http://localhost/document/${id}/connect?token=${token}`, {
    headers: { Upgrade: 'websocket' },
  });
  if (!response.webSocket) throw new Error('Expected a websocket');
  const socket = createTestWebSocket(response.webSocket);
  response.webSocket.accept();
  const initial = FromRemote.decode(new Uint8Array(await socket.waitForNextMessage() as ArrayBuffer));
  if (!initial.isRemoteInitialSync()) throw new Error('Expected initial snapshot');
  const doc = new LoroDoc();
  doc.import(initial.value.snapshot);
  const client = { ...socket, doc };
  clients.push(client);
  return client;
}

async function send(client: Client, updates: Uint8Array[]) {
  const id = crypto.randomUUID();
  client.send(FromPeer.fromPeerUpdate({ updates, id }).encode());
  for (;;) {
    const message = FromRemote.decode(new Uint8Array(await client.waitForNextMessage(2000) as ArrayBuffer));
    if (message.isRemoteUpdateAck() && message.value.id === id) return;
  }
}

function change(client: Client, text = ' Accepted body edit') {
  const from = client.doc.version();
  client.doc.getText('content').push(text);
  client.doc.commit();
  return client.doc.export({ mode: 'update', from });
}

async function edit(client: Client) {
  const update = change(client);
  await send(client, [update]);
  return update;
}

async function receiveUpdate(client: Client) {
  for (;;) {
    const message = FromRemote.decode(new Uint8Array(await client.waitForNextMessage(2000) as ArrayBuffer));
    if (message.isRemoteUpdate()) {
      client.doc.import(message.value.update);
      return;
    }
  }
}

function releaseHeld(documentId: string, status: number) {
  for (let i = heldRequests.length - 1; i >= 0; i--) {
    if (heldRequests[i].documentId === documentId) {
      heldRequests.splice(i, 1)[0].response.writeHead(status).end();
    }
  }
}

function snapshotText(snapshot: Uint8Array) {
  const doc = new LoroDoc();
  try {
    doc.import(snapshot);
    return doc.getText('content').toString();
  } finally {
    doc.free();
  }
}

const batches = (id: string) => (notifications.get(id) ?? []).filter((item) => item.editors.length > 0);
const waitForBatches = (id: string, count: number) => expect.poll(() => batches(id).length, {
  timeout: 12_000, interval: 100,
}).toBe(count);
const human = (actor: string): Editor => ({ actor, on_behalf_of: null });

it('attaches unique accepted editors to the existing snapshot notification', async () => {
  const id = await seed();
  await connect(id, 'macro|owner@example.com', 'bot|idle-agent');
  const viewer = await connect(id, 'macro|viewer@example.com', undefined, 'view');
  const alice = await connect(id, 'macro|alice@example.com');
  const bob = await connect(id, 'macro|bob@example.com');
  modes.set(id, 'hold_snapshot');
  await send(alice, [change(alice), change(alice)]);
  await edit(bob);
  viewer.send(FromPeer.fromPeerUpdate({ updates: [change(viewer, ' Forbidden')], id: crypto.randomUUID() }).encode());
  await expect.poll(() => heldRequests.some((request) => request.documentId === id), {
    timeout: 12_000,
  }).toBe(true);
  // No separate per-edit POST: the editor batch follows the existing snapshot upload.
  expect(notifications.get(id)).toEqual([{ editors: [] }]);
  modes.delete(id);
  releaseHeld(id, 200);
  await waitForBatches(id, 1);
  expect(batches(id)[0].editors).toHaveLength(2);
  expect(batches(id)[0].editors).toEqual(expect.arrayContaining([
    human('macro|alice@example.com'), human('macro|bob@example.com'),
  ]));
  expect(snapshotText(snapshots.get(id)!.at(-1)!)).not.toContain('Forbidden');
}, 20_000);

it('reports ongoing editors in later snapshots but excludes replayed operations', async () => {
  const id = await seed();
  const alice = await connect(id, 'macro|ongoing@example.com');
  const anonymous = await connect(id, null);
  const replay = await edit(alice);
  await waitForBatches(id, 1);
  const beforeReplay = notifications.get(id)!.length;
  await send(alice, [replay]);
  // Force another save with an accepted anonymous edit; the replay adds no editor.
  await edit(anonymous);
  await expect.poll(() => notifications.get(id)!.length, { timeout: 12_000 }).toBeGreaterThan(beforeReplay);
  expect(notifications.get(id)!.at(-1)).toEqual({ editors: [] });
  await edit(alice);
  await waitForBatches(id, 2);
  expect(batches(id)).toEqual([
    { editors: [human('macro|ongoing@example.com')] },
    { editors: [human('macro|ongoing@example.com')] },
  ]);
}, 30_000);

it('preserves agent subjects and excludes anonymous editors on last leave', async () => {
  const id = await seed();
  const aliceAgent = await connect(id, 'macro|alice@example.com', 'bot|document-agent');
  const bobAgent = await connect(id, 'macro|bob@example.com', 'bot|document-agent');
  const anonymous = await connect(id, null);
  await edit(aliceAgent);
  await edit(bobAgent);
  await edit(anonymous);
  for (const client of [aliceAgent, bobAgent, anonymous]) client.getWebSocket().close();
  await waitForBatches(id, 1);
  expect(batches(id)[0].editors).toHaveLength(2);
  expect(batches(id)[0].editors).toEqual(expect.arrayContaining([
    { actor: 'bot|document-agent', on_behalf_of: 'macro|alice@example.com' },
    { actor: 'bot|document-agent', on_behalf_of: 'macro|bob@example.com' },
  ]));
}, 20_000);

it('keeps lifecycle notifications empty when opening and closing without edits', async () => {
  const id = await seed();
  const viewer = await connect(id, 'macro|viewer@example.com', undefined, 'view');
  viewer.getWebSocket().close();
  await expect.poll(() => notifications.get(id)!.length, { timeout: 12_000 }).toBeGreaterThan(1);
  expect(notifications.get(id)!.every(({ editors }) => editors.length === 0)).toBe(true);
}, 20_000);

it.each([
  { user: 'macro|http-human@example.com', actor: undefined },
  { user: 'macro|http-owner@example.com', actor: 'bot|http-agent' },
])('includes $user attribution in both HTTP and websocket snapshot notifications', async ({ user, actor }) => {
  const id = await seed();
  const token = tokenFor(id, user, actor);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await mf.dispatchFetch(`http://localhost/document/${id}/state`, { headers });
  expect(response.status).toBe(200);
  const source = await response.json() as { snapshot: string; revision: string };
  const doc = new LoroDoc();
  doc.import(Buffer.from(source.snapshot, 'base64'));
  const from = doc.version();
  doc.getText('content').push(' HTTP edit');
  doc.commit();
  const updated = await mf.dispatchFetch(`http://localhost/document/${id}/update`, {
    method: 'POST', headers,
    body: JSON.stringify({ expectedRevision: source.revision,
      update: Buffer.from(doc.export({ mode: 'update', from })).toString('base64') }),
  });
  expect(updated.status).toBe(200);
  doc.free();
  const expected = actor ? { actor, on_behalf_of: user } : human(user);
  await waitForBatches(id, 1);
  expect(batches(id)[0]).toEqual({ editors: [expected] });
  const websocket = await connect(id, user, actor);
  await edit(websocket);
  await waitForBatches(id, 2);
  expect(batches(id)[1]).toEqual({ editors: [expected] });
}, 20_000);

it('keeps ACKs, broadcasts, and snapshot saves working while DSS notifications stall or fail', async () => {
  const id = await seed();
  const editor = await connect(id, 'macro|unblocked@example.com');
  const observer = await connect(id, 'macro|observer@example.com', undefined, 'view');
  modes.set(id, 'hold_notification');
  await edit(editor);
  await receiveUpdate(observer);
  await expect.poll(() => heldRequests.some((request) => request.documentId === id), {
    timeout: 12_000,
  }).toBe(true);
  const beforeStalledEdit = snapshots.get(id)!.length;
  await edit(editor);
  await receiveUpdate(observer);
  expect(observer.doc.getText('content').toString()).toBe(editor.doc.getText('content').toString());
  await expect.poll(() => snapshots.get(id)!.length, { timeout: 12_000 }).toBeGreaterThan(beforeStalledEdit);
  expect(snapshotText(snapshots.get(id)!.at(-1)!)).toBe(editor.doc.getText('content').toString());
  modes.set(id, 'fail_notification');
  releaseHeld(id, 503);
  const beforeFailedEdit = snapshots.get(id)!.length;
  await edit(editor);
  await receiveUpdate(observer);
  expect(observer.doc.getText('content').toString()).toBe(editor.doc.getText('content').toString());
  await expect.poll(() => snapshots.get(id)!.length, { timeout: 12_000 }).toBeGreaterThan(beforeFailedEdit);
  expect(snapshotText(snapshots.get(id)!.at(-1)!)).toBe(editor.doc.getText('content').toString());
  // A 503 must not trigger the legacy empty-body fallback for the failed batch.
  expect(rawNotifications.get(id)!.slice(1).every(({ editors }) => editors?.length === 1)).toBe(true);
}, 35_000);

it('retries with the legacy empty body only when older DSS rejects editor fields', async () => {
  const id = await seed();
  const editor = await connect(id, 'macro|legacy@example.com');
  modes.set(id, 'legacy');
  await edit(editor);
  await expect.poll(() => rawNotifications.get(id)!.length, { timeout: 12_000 }).toBe(3);
  expect(rawNotifications.get(id)!.slice(1)).toEqual([
    { editors: [human('macro|legacy@example.com')] },
    {},
  ]);
}, 20_000);
