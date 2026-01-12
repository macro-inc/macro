import { Miniflare } from "miniflare";
import { LoroDoc } from "loro-crdt";
import { FromRemote, FromPeer } from "../bebop/generated/schema";
import { expect, test, describe, beforeAll, assert } from "vitest";
import {
  connectToDocumentForTesting,
  createTestUser,
  setupMiniflare,
  createDocument,
} from "./utils";

let mf: Miniflare;

beforeAll(async () => {
  mf = await setupMiniflare();
});

describe("document sync tests", () => {
  test("should be healthy", async () => {
    const response = await mf.dispatchFetch("http://localhost:8087/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("healthy");
  });

  test("should receive initial sync on connect", async () => {
    const ws = await connectToDocumentForTesting(mf, "test");
    const next = await ws.waitForNextMessage();
    expect(next instanceof ArrayBuffer);

    const message = FromRemote.decode(new Uint8Array(next));
    expect(message.isRemoteInitialSync()).toBe(true);
  });

  test("should be able to load initial sync into loro", async () => {
    const ws = await connectToDocumentForTesting(mf, "test");
    const next = await ws.waitForNextMessage();
    expect(next instanceof ArrayBuffer);

    const message = FromRemote.decode(new Uint8Array(next));
    assert(message.isRemoteInitialSync());
    const loroDoc = new LoroDoc();
    let status = loroDoc.import(message.value.snapshot);
    assert(Object.entries(status.pending ?? {})?.length === 0);
  });

  test("changes should transmit between users", async () => {
    const wsA = await connectToDocumentForTesting(mf, "test");
    const wsB = await connectToDocumentForTesting(mf, "test");
    const next = await wsA.waitForNextMessage();
    expect(next instanceof ArrayBuffer);

    const message = FromRemote.decode(new Uint8Array(next));
    const loroDoc = new LoroDoc();
    assert(message.isRemoteInitialSync());
    loroDoc.import(message.value.snapshot);

    loroDoc.getText("content").push("hello world");
    loroDoc.commit();

    let update = loroDoc.export({ mode: "update" });

    wsA.send(
      FromPeer.fromPeerUpdate({
        update: update,
      }).encode(),
    );

    const bFirstMessage = await wsB.waitForNextMessage();
    const bSecondMessage = await wsB.waitForNextMessage();

    let bInitialSync = FromRemote.decode(new Uint8Array(bFirstMessage));
    assert(bInitialSync.isRemoteInitialSync());
    let bSync = FromRemote.decode(new Uint8Array(bSecondMessage));
    assert(bSync.isRemoteUpdate());

    const loroDocB = new LoroDoc();
    loroDocB.import(bInitialSync.value.snapshot);
    loroDocB.import(bSync.value.update);
    expect(loroDocB.getText("content").toString()).toBe("hello world");
  });

  test("user connecting in middle of sync should receive all changes", async () => {
    const userA = await createTestUser(mf, "1234");
    expect(userA.getState()).toBe("");
    const userB = await createTestUser(mf, "1234");
    const userC = await createTestUser(mf, "1234");
    userA.makeChange("hello world");
    userB.import(await userB.readSyncMessage());
    userC.import(await userC.readSyncMessage());

    expect(userA.getState()).toBe("hello world");
    expect(userB.getState()).toBe("hello world");
    expect(userC.getState()).toBe("hello world");

    userB.makeChange(" goodbye world");
    userA.import(await userA.readSyncMessage());
    userC.import(await userC.readSyncMessage());

    expect(userA.getState()).toBe("hello world goodbye world");
    expect(userB.getState()).toBe("hello world goodbye world");
    expect(userC.getState()).toBe("hello world goodbye world");

    userB.makeChange(" hello again world");
    const userD = await createTestUser(mf, "1234");

    expect(userD.getState()).toBe(
      "hello world goodbye world hello again world",
    );
  });

  test("re-importing same update has no affect", async () => {
    const userA = await createTestUser(mf, "12345");
    const userB = await createTestUser(mf, "12345");
    userA.makeChange("hello world");
    let userBMessage = await userB.readSyncMessage();
    userB.import(userBMessage);
    userB.import(userBMessage);
    expect(userA.getState()).toBe("hello world");
    expect(userB.getState()).toBe("hello world");
  });

  test("batch importing works", async () => {
    const userA = await createTestUser(mf, "12346");
    const userB = await createTestUser(mf, "12346");
    userA.makeChange("hello world");
    let userBMessage = await userB.readSyncMessage();
    userA.makeChange(" goodbye world");
    let userBMessage2 = await userB.readSyncMessage();
    userA.batchImport([userBMessage, userBMessage2]);
    userB.batchImport([userBMessage, userBMessage2]);
    // double check that double importing doesn't do anything
    userB.batchImport([userBMessage, userBMessage2]);
    expect(userB.getState()).toBe("hello world goodbye world");
  });

  test("non-text based exampe", async () => {
    const docA = new LoroDoc();
    const connectionA = await connectToDocumentForTesting(mf, "12347");

    const docB = new LoroDoc();
    const connectionB = await connectToDocumentForTesting(mf, "12347");
    connectionB.waitForNextMessage();

    let tree = docA.getTree("tree");

    for (let i = 0; i < 10; i++) {
      let node = tree.createNode(undefined, i);
      node.data.set("test", i);
    }

    docA.commit();
    connectionA.send(
      FromPeer.fromPeerUpdate({
        update: docA.export({ mode: "update" }),
      }).encode(),
    );

    let meessage = await connectionB.waitForNextMessage();
    const sync = FromRemote.decode(new Uint8Array(meessage));
    assert(sync.isRemoteUpdate());
    docB.import(sync.value.update);

    expect(docB.toJSON()).toStrictEqual(docA.toJSON());
  });

  test("document state persists after 15 second timeout", async () => {
    let doc = await createDocument(mf);
    let [userA, userB] = await doc.createMultipleUsers(2);

    userA.makeChange("hello world");
    userB.import(await userB.readSyncMessage());
    userB.makeChange(" goodbye world");
    userA.import(await userA.readSyncMessage());

    expect(userA.getState()).toBe("hello world goodbye world");
    expect(userB.getState()).toBe("hello world goodbye world");

    await new Promise((resolve) => setTimeout(resolve, 15000));

    const userC = await doc.createUser();
    expect(userC.getState()).toBe("hello world goodbye world");
  }, 30000);

  test("user gets remote update-ack", async () => {
    let doc = await createDocument(mf);
    let userA = await doc.createUser();
    userA.makeChange("hello world");
    expect(userA.getState()).toBe("hello world");
    expect((await userA.readNextMessage()).isRemoteUpdateAck()).toBeTruthy();
  }, 30000);
});
