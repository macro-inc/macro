import { LoroDoc } from "loro-crdt";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  FromPeer,
  InitializeFromSnapshotRequest,
} from "../bebop/generated/schema";
import {
  copyDocument,
  createTestUser,
  getTokenForDocument,
  setupMiniflare,
} from "./utils";

// Document history names the author of every peer through /metadata, so each
// path that writes operations must map the peers it writes with.

let mf: Miniflare;

beforeAll(async () => {
  mf = await setupMiniflare();
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

async function initialize(documentId: string, snapshot: Uint8Array) {
  const response = await mf.dispatchFetch(
    `http://localhost:8787/document/${documentId}/initialize`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        Authorization: `Bearer ${getTokenForDocument(documentId, "importer", "owner")}`,
      },
      body: InitializeFromSnapshotRequest.encode({ snapshot }),
    },
  );
  expect(response.status).toBe(200);
}

async function authors(documentId: string): Promise<Record<string, string>> {
  const response = await mf.dispatchFetch(
    `http://localhost:8787/document/${documentId}/metadata`,
    {
      headers: {
        Authorization: `Bearer ${getTokenForDocument(documentId, "reader", "view")}`,
      },
    },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    peers: { peer_id: string; user_id: string }[];
  };
  return Object.fromEntries(body.peers.map((p) => [p.peer_id, p.user_id]));
}

describe("peer authors", () => {
  test("an initialized snapshot's peers belong to the system author", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(1001n);
    doc.getText("content").insert(0, "imported markdown");
    doc.commit();

    await initialize("initialized-doc", doc.export({ mode: "snapshot" }));

    expect(await authors("initialized-doc")).toEqual({ "1001": "system" });
  });

  test("a websocket write maps peers the client never registered", async () => {
    const seed = new LoroDoc();
    seed.setPeerId(2001n);
    seed.getText("content").insert(0, "start");
    seed.commit();
    await initialize("websocket-doc", seed.export({ mode: "snapshot" }));

    const user = await createTestUser(mf, "websocket-doc", { userId: "editor-user" });
    const registeredPeer = user.doc.peerIdStr;
    // A client's peer id can change after it registered; its edits arrive
    // under the new id without another registration.
    const from = user.doc.version();
    user.doc.setPeerId(2002n);
    user.doc.getText("content").insert(0, "typed ");
    user.doc.commit();
    user.connection.send(
      FromPeer.fromPeerUpdate({
        updates: [user.doc.export({ mode: "update", from })],
        id: crypto.randomUUID(),
      }).encode(),
    );
    const ack = await user.readNextMessage();
    expect(ack.isRemoteUpdateAck()).toBe(true);

    expect(await authors("websocket-doc")).toEqual({
      "2001": "system",
      "2002": "editor-user",
      [registeredPeer]: "editor-user",
    });
    user.getWebSocket().close();
  });

  test("an HTTP update maps its peers to the token's user", async () => {
    const doc = new LoroDoc();
    doc.setPeerId(3001n);
    doc.getText("content").insert(0, "start");
    doc.commit();
    await initialize("http-doc", doc.export({ mode: "snapshot" }));

    const from = doc.version();
    const expectedRevision = Buffer.from(from.encode()).toString("base64");
    doc.setPeerId(3002n);
    doc.getText("content").insert(0, "agent ");
    doc.commit();
    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/http-doc/update",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getTokenForDocument("http-doc", "editor-user", "edit")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedRevision,
          update: Buffer.from(doc.export({ mode: "update", from })).toString(
            "base64",
          ),
        }),
      },
    );
    expect(response.status).toBe(200);

    expect(await authors("http-doc")).toEqual({
      "3001": "system",
      "3002": "editor-user",
    });
  });

  test("a copy keeps the source document's authors", async () => {
    const seed = new LoroDoc();
    seed.setPeerId(4001n);
    seed.getText("content").insert(0, "start");
    seed.commit();
    await initialize("copy-source", seed.export({ mode: "snapshot" }));
    const user = await createTestUser(mf, "copy-source", { userId: "editor-user" });
    user.makeChange(" edited");
    const ack = await user.readNextMessage();
    expect(ack.isRemoteUpdateAck()).toBe(true);
    user.getWebSocket().close();

    const response = await copyDocument(mf, "copy-source", "copy-target");
    expect(response.status).toBe(200);

    expect(await authors("copy-target")).toEqual({
      "4001": "system",
      [user.doc.peerIdStr]: "editor-user",
    });
  });
});
