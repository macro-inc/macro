import { Miniflare } from "miniflare";
import { test, describe, beforeAll, expect } from "vitest";
import {
  connectToDocumentForTesting,
  createTestUser,
  setupMiniflare,
} from "./utils";
import { FromPeer, FromRemote } from "../bebop/generated/schema";

let mf: Miniflare;

beforeAll(async () => {
  mf = await setupMiniflare();
});

describe("should respect permissions", () => {
  test("should not allow view only user to push updates", async () => {
    const userA = await createTestUser(mf, "test", {
      userId: "view-only-user",
      permissionLevel: "view",
    });

    userA.makeChange("hello world");

    await new Promise((resolve) => setTimeout(resolve, 300));

    const userB = await createTestUser(mf, "test");
    const userC = await createTestUser(mf, "test", {
      userId: "view-only-user-c",
      permissionLevel: "view",
    });

    expect(userB.getState()).toBe("");

    userB.makeChange("hello world");

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(userB.getState()).toBe("hello world");

    // User c should still be receiving updates from user a
    let update = await userC.readSyncMessage();
    userC.import(update);
    expect(userC.getState()).toBe("hello world");
  });

  test("should allow all users with a token to connect", async () => {
    expect(
      async () => await connectToDocumentForTesting(mf, "test", {
        userId: "view-only-user",
        permissionLevel: "view",
      }),
    ).not.toThrow();
    expect(
      async () => await connectToDocumentForTesting(mf, "test", {
        userId: "comment-user",
        permissionLevel: "comment",
      }),
    ).not.toThrow();
    expect(
      async () => await connectToDocumentForTesting(mf, "test", {
        userId: "edit-user",
        permissionLevel: "edit",
      }),
    ).not.toThrow();
    expect(
      async () => await connectToDocumentForTesting(mf, "test", {
        userId: "owner-user",
        permissionLevel: "owner",
      }),
    ).not.toThrow();
  });

  test("should allow view only user to push awareness", async () => {
    const userA = await createTestUser(mf, "test", {
      userId: "view-only-user",
      permissionLevel: "view",
    });

    const userB = await createTestUser(mf, "test");

    userA.awareness.set(userA.doc.peerIdStr, {
      name: "test",
    });

    let awarenessUpdate = userA.awareness.encode(userA.doc.peerIdStr);

    userA.connection.send(
      FromPeer.fromPeerAwareness({ awareness: awarenessUpdate }).encode(),
    );

    let message = await userB.waitForNextMessage();

    let remoteAwareness = FromRemote.decode(new Uint8Array(message));

    expect(remoteAwareness.isRemoteAwareness()).toBe(true);

    userB.awareness.apply((remoteAwareness.value as any).awareness);

    expect(userB.awareness.getAllStates()[userA.doc.peerIdStr]).toBeDefined();
  });
});
