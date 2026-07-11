import { Miniflare } from "miniflare";
import {
  FromPeer,
    FromRemote,
    RemoteAwareness,
} from "../bebop/generated/schema";
import { expect, test, describe, beforeAll } from "vitest";
import { createTestUser, setupMiniflare } from "./utils";

let mf: Miniflare;

beforeAll(async () => {
  mf = await setupMiniflare();
});

describe("awareness sync tests", () => {
  test("should include awareness on connection if available", async () => {
    const userA = await createTestUser(mf, "1234");
    // Initialize with some text
    userA.doc.getText("content").push("hello world");
    const cursor = userA.doc.getText("content").getCursor(5);
    expect(cursor).toBeDefined();
    userA.doc.commit();
    userA.awareness.set(userA.doc.peerIdStr, {
      cursor: cursor!.encode(),
    })
    let awarenessUpdate = userA.awareness.encode(userA.doc.peerIdStr);
    const update = userA.doc.export({ mode: "update" });

    userA.connection.send(FromPeer.fromPeerUpdate({ update}).encode());
    userA.connection.send(FromPeer.fromPeerAwareness({ awareness: awarenessUpdate }).encode());

    const userB = await createTestUser(mf, "1234");
    expect(userB.awareness.getAllStates()[userA.doc.peerIdStr]).toBeDefined();
  });

  test("should broadcast awareness when one client disconnects", async () => {
    const userA = await createTestUser(mf, "1234");
    // Initialize with some text
    userA.doc.getText("content").push("hello world");
    const cursor = userA.doc.getText("content").getCursor(5);
    expect(cursor).toBeDefined();
    userA.doc.commit();
    userA.awareness.set(userA.doc.peerIdStr, {
      cursor: cursor!.encode(),
    })
    let awarenessUpdate = userA.awareness.encode(userA.doc.peerIdStr);
    const update = userA.doc.export({ mode: "update" });

    userA.connection.send(FromPeer.fromPeerUpdate({ update}).encode());
    userA.connection.send(FromPeer.fromPeerAwareness({ awareness: awarenessUpdate }).encode());

    const userB = await createTestUser(mf, "1234");
    expect(userB.awareness.getAllStates()[userA.doc.peerIdStr]).toBeDefined();

    // When userA disconnects, the service should broadcast an undefined awareness update
    // for userA to all listeners
    userA.connection.getWebSocket().close();

    let newMessage = await userB.connection.waitForNextMessage();
    const awareness = FromRemote.decode(new Uint8Array(newMessage));
    expect(awareness.isRemoteAwareness()).toBeTruthy();
    userB.awareness.apply((awareness.value as RemoteAwareness ).awareness);
    expect(userB.awareness.getAllStates()[userA.doc.peerIdStr]).toBeUndefined();
  })
})
