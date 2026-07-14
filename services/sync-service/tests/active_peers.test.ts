import { Miniflare } from "miniflare";
import { expect, test, describe, beforeEach } from "vitest";
import { createTestUser, getTokenForDocument, setupMiniflare } from "./utils";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

describe("active_peers endpoint tests", async () => {
  test("should return active peer IDs for document with single user", async () => {
    // Create a document with one user
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("Hello from single user!");

    // Wait for the change to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get token for API access
    const token = getTokenForDocument("test-doc", "test-user", "owner");

    // Fetch active peer IDs
    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/active_peers",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);

    const activePeerIds = await response.json();
    expect(activePeerIds).toBeDefined();
    expect(Array.isArray(activePeerIds)).toBe(true);
    expect(activePeerIds.length).toBe(1);
    expect(activePeerIds[0]).toBe(user.doc.peerIdStr);

    user.connection.getWebSocket().close();
  });

  test("should return multiple active peer IDs for document with multiple users", async () => {
    // Create document with multiple users
    const userA = await createTestUser(mf, "test-doc", { userId: "user-a" });
    const userB = await createTestUser(mf, "test-doc", { userId: "user-b" });
    const userC = await createTestUser(mf, "test-doc", { userId: "user-c" });

    userA.makeChange("Change from user A");
    userB.makeChange(" - Change from user B");
    userC.makeChange(" - Change from user C");

    // Wait for changes to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    const token = getTokenForDocument("test-doc", "test-user", "owner");

    // Fetch active peer IDs
    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/active_peers",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);

    const activePeerIds = await response.json();
    expect(activePeerIds).toBeDefined();
    expect(Array.isArray(activePeerIds)).toBe(true);
    expect(activePeerIds.length).toBe(3);

    // Verify all peer IDs are present
    expect(activePeerIds).toContain(userA.doc.peerIdStr);
    expect(activePeerIds).toContain(userB.doc.peerIdStr);
    expect(activePeerIds).toContain(userC.doc.peerIdStr);

    // Clean up connections
    userA.connection.getWebSocket().close();
    userB.connection.getWebSocket().close();
    userC.connection.getWebSocket().close();
  });

  test("should require authentication for active_peers endpoint", async () => {
    // Create document
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("Protected content");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to fetch without token
    const responseWithoutAuth = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/active_peers"
    );

    expect(responseWithoutAuth.status).toBe(401);

    // Try with invalid token
    const responseWithBadToken = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/active_peers",
      {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      }
    );

    expect(responseWithBadToken.status).toBe(401);

    user.connection.getWebSocket().close();
  });

  test("should return empty array for non-existent document", async () => {
    const token = getTokenForDocument("non-existent-doc", "test-user", "owner");

    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/non-existent-doc/active_peers",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    // Should return 200 with empty array or 404, depending on implementation
    expect([200, 404]).toContain(response.status);

    if (response.status === 200) {
      const activePeerIds = await response.json();
      expect(Array.isArray(activePeerIds)).toBe(true);
      expect(activePeerIds.length).toBe(0);
    }
  });

  test("should update active peer IDs when user disconnects", async () => {
    // Create document with two users
    const userA = await createTestUser(mf, "test-doc", { userId: "user-a" });
    const userB = await createTestUser(mf, "test-doc", { userId: "user-b" });

    userA.makeChange("User A content");
    userB.makeChange("User B content");

    await new Promise((resolve) => setTimeout(resolve, 200));

    const token = getTokenForDocument("test-doc", "test-user", "owner");

    // Initially should have 2 active peers
    let response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/active_peers",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);
    let activePeerIds = await response.json();
    expect(activePeerIds.length).toBe(2);

    // Disconnect one user
    userA.connection.getWebSocket().close();

    // Wait for disconnect to be processed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should now have 1 active peer
    response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/active_peers",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);
    activePeerIds = await response.json();
    expect(activePeerIds.length).toBe(1);
    expect(activePeerIds[0]).toBe(userB.doc.peerIdStr);

    userB.connection.getWebSocket().close();
  }, 10000);
});
