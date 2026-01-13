import { Miniflare } from "miniflare";
import { LoroDoc } from "loro-crdt";
import { expect, test, describe, beforeEach } from "vitest";
import { createTestUser, getTokenForDocument, setupMiniflare } from "./utils";
import { InitializeFromSnapshotRequest } from "../bebop/generated/schema";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

describe("document api tests", async () => {
  test("should properly initialize the document", async () => {
    const doc: LoroDoc = new LoroDoc();
    doc.getText("content").update("hello world 121");
    doc.commit();
    const snapshot = doc.export({ mode: "snapshot" });

    let req = InitializeFromSnapshotRequest.encode({
      snapshot: snapshot,
    });

    const token = getTokenForDocument("test-doc", "test-user", "owner");

    await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/initialize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: "Bearer " + token,
        },
        body: req,
      },
    );
    let user = await createTestUser(mf, "test-doc");
    expect(user.getState()).toBe("hello world 121");
  });

  test("should reject snapshot if already exists", async () => {
    const doc: LoroDoc = new LoroDoc();
    doc.getText("content").update("hello world 121");
    doc.commit();

    const snapshot = doc.export({ mode: "snapshot" });

    const req = InitializeFromSnapshotRequest.encode({
      snapshot: snapshot,
    });

    const token = getTokenForDocument("test-doc", "test-user", "owner");

    let firstResponse = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/initialize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: "Bearer " + token,
        },
        body: req,
      },
    );

    expect(firstResponse.status).toBe(200);

    doc.getText("content").update("hello world 222");
    doc.commit();

    const snapshot2 = doc.export({ mode: "snapshot" });

    let response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/initialize",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/octet-stream",
        },
        body: InitializeFromSnapshotRequest.encode({
          snapshot: snapshot2,
        }),
      },
    );

    expect(response.status).toBe(500);

    let user = await createTestUser(mf, "test-doc");

    expect(user.getState()).toBe("hello world 121");
  });

  test("should fetch correct metadata about document", async () => {
    const userA = await createTestUser(mf, "test-doc");
    const userB = await createTestUser(mf, "test-doc");

    const peeridA = userA.doc.peerIdStr;
    const peeridB = userB.doc.peerIdStr;

    const token = getTokenForDocument("test-doc", "test-user", "owner");

    const metadata = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/metadata",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    );

    const json = (await metadata.json()) as {
      id: string;
      peers: Array<{
        peer_id: string;
        user_id: string;
      }>;
      version_id: string;
    };

    expect(json.id).toBe("test-doc");
    expect(json.peers.length).toBe(2);
    expect(json.version_id).toBe("");

    expect(json.peers.find((p) => p.peer_id == peeridA)).toBeTruthy();
    expect(json.peers.find((p) => p.peer_id == peeridB)).toBeTruthy();
  });

  test("should increment document version id counter", async () => {
    const userA = await createTestUser(mf, "test-doc");
    const token = getTokenForDocument("test-doc", "test-user", "owner");
    const version_id_og: number = (await (await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/metadata",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    )).json()).version_id;

    userA.makeChange("hello world 123");

    await new Promise((resolve) => setTimeout(resolve, 100));
    userA.connection.getWebSocket().close();
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const version_id: number = (await (await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/metadata",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      },
    )).json()).version_id;

    expect(version_id != version_id_og).toBe(true);
  }, 6000);

  test("should copy document to new location", async () => {
    const userA = await createTestUser(mf, "test-doc");
    userA.makeChange("hello world 123");

    // give document a change to save the snapshot
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/copy",
      {
        method: "POST",
        body: JSON.stringify({
          target_document_id: "test-doc-copy",
        }),
        headers: {
          "x-internal-auth-key": "local",
          "Content-Type": "application/json",
        },
      },
    );

    expect(response.status).toBe(200);

    const userB = await createTestUser(mf, "test-doc-copy");

    expect(userB.getState()).toBe("hello world 123");
  }, 10000);

  test("should copy document to new location with specific version", async () => {
    const userA = await createTestUser(mf, "test-doc");
    userA.makeChange("v1");

    const frontier = userA.doc.vvToFrontiers(userA.doc.version())[0];

    userA.makeChange("v2");

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/copy",
      {
        method: "POST",
        body: JSON.stringify({
          target_document_id: "test-doc-copy",
          version_id: {
            peer: frontier.peer,
            counter: frontier.counter,
          },
        }),
        headers: {
          "x-internal-auth-key": "local",
          "Content-Type": "application/json",
        },
      },
    );

    expect(response.status).toBe(200);

    const userB = await createTestUser(mf, "test-doc-copy");

    expect(userB.getState()).toBe("v1");
  }, 10000);
});
