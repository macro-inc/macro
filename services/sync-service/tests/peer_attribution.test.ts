import jwt from "jsonwebtoken";
import { LoroDoc } from "loro-crdt";
import { Miniflare } from "miniflare";
import { beforeEach, expect, test } from "vitest";
import { FromPeer, FromRemote, InitializeFromSnapshotRequest } from "../bebop/generated/schema";
import { copyDocument, createTestWebSocket, getTokenForDocument, setupMiniflare } from "./utils";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

const documentId = "attribution-doc";

/** Connect with `claims`, register `peer`, and write one edit under it. The
 *  edit's ack proves the registration before it has been handled. */
async function editAs(claims: Record<string, string>, peer: bigint, text: string) {
  const token = jwt.sign(
    { document_id: documentId, access_level: "edit", exp: Math.floor(Date.now() / 1000) + 60, ...claims },
    "local",
  );
  const response = await mf.dispatchFetch(
    `http://localhost:8787/document/${documentId}/connect?token=${token}`,
    { headers: { Upgrade: "websocket" } },
  );
  const ws = response.webSocket!;
  const socket = createTestWebSocket(ws);
  ws.accept();
  const initialSync = FromRemote.decode(new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer));
  expect(initialSync.isRemoteInitialSync()).toBe(true);
  const doc = new LoroDoc();
  doc.setPeerId(peer);
  if (initialSync.isRemoteInitialSync()) doc.import(initialSync.value.snapshot);
  socket.send(FromPeer.fromPeerRegisterId({ peerid: peer }).encode());
  doc.getText("content").insert(0, text);
  doc.commit();
  socket.send(FromPeer.fromPeerUpdate({ updates: [doc.export({ mode: "update" })], id: crypto.randomUUID() }).encode());
  const ack = FromRemote.decode(new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer));
  expect(ack.isRemoteUpdateAck()).toBe(true);
  ws.close();
}

const authorized = (path: string) =>
  mf.dispatchFetch(`http://localhost:8787/document/${documentId}/${path}`, {
    headers: { Authorization: `Bearer ${getTokenForDocument(documentId, "reader", "view")}` },
  });

test("an agent's AI peer resolves to the agent in metadata and blame", async () => {
  const aiPeer = 0xa1a1_a100_0000_0001n;
  const humanPeer = 4242n;
  await editAs({ user_id: "macro|owner@example.com", actor: "bot|agent-1" }, aiPeer, "agent ");
  await editAs({ user_id: "macro|human@example.com" }, humanPeer, "human ");

  const metadata = (await (await authorized("metadata")).json()) as {
    peers: { peer_id: string; user_id: string; actor: string | null }[];
  };
  expect(metadata.peers).toEqual(
    expect.arrayContaining([
      { peer_id: aiPeer.toString(), user_id: "macro|owner@example.com", actor: "bot|agent-1" },
      { peer_id: humanPeer.toString(), user_id: "macro|human@example.com", actor: null },
    ]),
  );

  const db = await mf.getD1Database("USER_PEER_MAPPING");
  await db
    .prepare("INSERT INTO blame (document_id, node_id, peer_id, timestamp_ms) VALUES (?, 'node', ?, 7)")
    .bind(documentId, aiPeer.toString())
    .run();
  expect(await (await authorized("blame/node")).json()).toEqual({
    peer_id: aiPeer.toString(),
    user_id: "macro|owner@example.com",
    actor: "bot|agent-1",
    timestamp_ms: 7,
  });
});

test("an agent's HTTP update records the agent, and a copy keeps it", async () => {
  const doc = new LoroDoc();
  doc.setPeerId(5001n);
  doc.getText("content").insert(0, "start");
  doc.commit();
  const initialized = await mf.dispatchFetch(`http://localhost:8787/document/${documentId}/initialize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      Authorization: `Bearer ${getTokenForDocument(documentId, "importer", "owner")}`,
    },
    body: InitializeFromSnapshotRequest.encode({ snapshot: doc.export({ mode: "snapshot" }) }),
  });
  expect(initialized.status).toBe(200);

  const from = doc.version();
  const aiPeer = 0xa1a1_a100_0000_0002n;
  doc.setPeerId(aiPeer);
  doc.getText("content").insert(0, "agent ");
  doc.commit();
  const agentToken = jwt.sign(
    {
      user_id: "macro|owner@example.com",
      actor: "bot|agent-1",
      document_id: documentId,
      access_level: "edit",
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    "local",
  );
  const updated = await mf.dispatchFetch(`http://localhost:8787/document/${documentId}/update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedRevision: Buffer.from(from.encode()).toString("base64"),
      update: Buffer.from(doc.export({ mode: "update", from })).toString("base64"),
    }),
  });
  expect(updated.status).toBe(200);

  const agentPeer = { peer_id: aiPeer.toString(), user_id: "macro|owner@example.com", actor: "bot|agent-1" };
  const metadata = (await (await authorized("metadata")).json()) as { peers: unknown[] };
  expect(metadata.peers).toContainEqual(agentPeer);

  expect((await copyDocument(mf, documentId, "attribution-copy")).status).toBe(200);
  const copied = await mf.dispatchFetch("http://localhost:8787/document/attribution-copy/metadata", {
    headers: { Authorization: `Bearer ${getTokenForDocument("attribution-copy", "reader", "view")}` },
  });
  expect(((await copied.json()) as { peers: unknown[] }).peers).toContainEqual(agentPeer);
});

test("re-registering a peer someone else owns keeps its original author", async () => {
  const peer = 0xa1a1_a100_0000_0003n;
  await editAs({ user_id: "macro|owner@example.com", actor: "bot|agent-1" }, peer, "agent ");
  await editAs({ user_id: "macro|other@example.com" }, peer, "other ");

  const metadata = (await (await authorized("metadata")).json()) as { peers: unknown[] };
  expect(metadata.peers).toContainEqual({
    peer_id: peer.toString(),
    user_id: "macro|owner@example.com",
    actor: "bot|agent-1",
  });
});
