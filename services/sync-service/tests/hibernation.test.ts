import jwt from 'jsonwebtoken';
import { LoroDoc } from 'loro-crdt';
import { createFetchMock, type Miniflare } from 'miniflare';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FromPeer, FromRemote } from '../../../crates/sync_protocol/bebop/generated/schema';
import { abortObjectBetweenMessages, createTestUser, createTestWebSocket, getTokenForDocument, setupMiniflare } from './utils';

vi.setConfig({ testTimeout: 15_000 });

let mf: Miniflare;
let editorNotice: PromiseWithResolvers<unknown>;
beforeEach(async () => {
  editorNotice = Promise.withResolvers();
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  for (const method of ['POST', 'PUT']) {
    fetchMock.get('https://dss.test').intercept({ path: /.*/, method }).reply(200, options => {
      if (options.path.endsWith('/sync-content-updated')) {
        void new Response(options.body).json().then(body => {
          if (body.editors?.length) editorNotice.resolve(body.editors);
        }, editorNotice.reject);
      }
      return '';
    }).persist();
  }
  mf = await setupMiniflare({ fetchMock });
});
afterEach(async () => { await mf?.dispose(); });

async function stub(id: string) {
  const namespace = await mf.getDurableObjectNamespace('DOCUMENT_SYNC_SESSION');
  return namespace.get(namespace.idFromName(id));
}

async function abort(id: string) {
  await abortObjectBetweenMessages(await stub(id));
}

async function read(id: string, path: string) {
  return mf.dispatchFetch(`http://localhost/document/${id}/${path}`, {
    headers: { authorization: `Bearer ${getTokenForDocument(id, 'test-user', 'owner')}` },
  });
}

async function ping(user: Awaited<ReturnType<typeof createTestUser>>) {
  user.send('ping');
  expect(await user.waitForNextMessage()).toBe('pong');
}

async function content(id: string) {
  const response = await read(id, 'snapshot');
  expect(response.status).toBe(200);
  const doc = new LoroDoc();
  doc.import(new Uint8Array(await response.arrayBuffer()));
  const value = doc.getText('content').toString();
  doc.free();
  return value;
}

test('H1 restores the websocket tag after eviction', async () => {
  const user = await createTestUser(mf, 'hibernate-h1');
  await ping(user);
  await abort('hibernate-h1');
  await ping(user);
});

test('H2 lazily restores stored websocket metadata', async () => {
  const user = await createTestUser(mf, 'hibernate-h2');
  await ping(user);
  await abort('hibernate-h2');
  user.makeChange('restored writer');
  expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  expect(await content('hibernate-h2')).toBe('restored writer');
});

test('H3 filters signed agents and reserved AI peers after eviction', async () => {
  const id = 'hibernate-h3';
  const user = await createTestUser(mf, id);
  user.send(FromPeer.fromPeerRegisterId({ peerid: 0xa1a1_a100_0000_0001n }).encode());
  await ping(user);
  const token = jwt.sign({ document_id: id, user_id: 'test-user', actor: 'bot|test-agent', access_level: 'edit', exp: Math.floor(Date.now() / 1000) + 60 }, 'local');
  const response = await mf.dispatchFetch(`http://localhost/document/${id}/connect?token=${token}`, { headers: { Upgrade: 'websocket' } });
  const socket = createTestWebSocket(response.webSocket!);
  response.webSocket!.accept();
  await socket.waitForNextMessage();
  socket.send(FromPeer.fromPeerRegisterId({ peerid: 123456n }).encode());
  socket.send('ping');
  expect(await socket.waitForNextMessage()).toBe('pong');
  await abort(id);
  const peers = await (await read(id, 'active_peers?include_ai=false')).json();
  expect(peers).toEqual([user.doc.peerIdStr]);
  expect(await (await read(id, 'active_peers?include_ai=true')).json()).toHaveLength(3);
});

test('H4 restores edit attribution from signed socket claims', async () => {
  const id = 'hibernate-h4';
  const user = await createTestUser(mf, id, { userId: 'restored-author' });
  await ping(user);
  await abort(id);
  user.makeChange('attributed after eviction');
  expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  user.getWebSocket().close();
  expect(await editorNotice.promise).toEqual([{ actor: 'restored-author', on_behalf_of: null }]);
});

test('H5 restores read-only write permissions after eviction', async () => {
  const id = 'hibernate-h5';
  const viewer = await createTestUser(mf, id, { permissionLevel: 'view' });
  await ping(viewer);
  await abort(id);
  viewer.makeChange('must not be persisted');
  await ping(viewer);
  expect(await content(id)).toBe('');
});

test('H6 restores DOCUMENT_ID after eviction', async () => {
  const id = 'hibernate-h6';
  const user = await createTestUser(mf, id);
  await ping(user);
  await abort(id);
  const response = await read(id, 'metadata');
  expect(response.status).toBe(200);
  expect(await response.json()).toHaveProperty('id', id);
});

test('H7 reconstructs storage with the original room identity', async () => {
  const first = await createTestUser(mf, 'hibernate-h7-first');
  const second = await createTestUser(mf, 'hibernate-h7-second');
  first.makeChange('first room');
  second.makeChange('second room');
  expect((await first.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  expect((await second.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  await abort('hibernate-h7-first');
  expect(await content('hibernate-h7-first')).toBe('first room');
  expect(await content('hibernate-h7-second')).toBe('second room');
});

test('H8 loads the snapshot and replays pending operations', async () => {
  const id = 'hibernate-h8';
  const user = await createTestUser(mf, id);
  user.makeChange('pending first');
  expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  user.makeChange(' then second');
  expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  await abort(id);
  expect(await content(id)).toBe('pending first then second');
});

test('H9 keeps applied keys across exists and compacts them', async () => {
  const id = 'hibernate-h9';
  const user = await createTestUser(mf, id);
  user.makeChange('survives replay');
  expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  await abort(id);
  user.makeChange(' after restore');
  expect((await user.readNextMessage()).isRemoteUpdateAck()).toBe(true);
  const exists = await read(id, 'exists');
  expect(exists.status).toBe(200);
  await exists.arrayBuffer();
  const target = await stub(id);
  const compacted = await target.fetch('http://sync-test/__sync_test_alarm');
  expect(await compacted.text()).toBe('ok');
  const dump = await (await target.fetch('http://sync-test/__sync_test_dump')).json() as { kv: [string, unknown][] };
  expect(dump.kv.some(([key]) => key.startsWith('o/'))).toBe(false);
  expect(await content(id)).toBe('survives replay after restore');
});

test('H10 discards an incomplete inbound frame on eviction', async () => {
  const id = 'hibernate-h10';
  const user = await createTestUser(mf, id);
  await ping(user);
  const request = FromPeer.fromPeerRequestSnapshot({}).encode();
  const split = Math.floor(request.length / 2);
  user.getWebSocket().send(new Uint8Array([0, ...request.slice(0, split)]));
  await ping(user);
  await abort(id);
  user.getWebSocket().send(new Uint8Array([1, ...request.slice(split)]));
  await ping(user);
  user.send(request);
  const message = await user.waitForNextMessage();
  expect(FromRemote.decode(new Uint8Array(message as ArrayBuffer)).isRemoteSnapshot()).toBe(true);
});
