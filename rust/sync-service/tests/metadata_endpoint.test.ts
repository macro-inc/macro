import { Miniflare } from "miniflare";
import { expect, test, describe, beforeEach } from "vitest";
import { createTestUser, getTokenForDocument, setupMiniflare } from "./utils";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

describe("metadata endpoint tests", async () => {
  const make_user = async (opts) => {
    opts.documentId ??= 'test-doc';
    opts.permissionLevel ??= "owner";
    const user = await createTestUser(mf, opts.documentId, opts);
    return { user, opts }
  };
  const get_metadata = async (opts) => {
    const { documentId, userId, permissionLevel } = opts;
    const token = getTokenForDocument(opts.documentId, opts.userId, opts.permissionLevel);
    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/metadata",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );
    expect(response.status).toBe(200);
    const metadata = await response.json() as {
      id: string;
      peers: Array<{
        peer_id: string;
        user_id: string;
      }>;
      version_id: string;
    };
    return metadata;
  }

  test("should return correct metadata for document with single user", async () => {
    // Create a document with one user
    const {user, opts} = await make_user({ userId: 'single-user' });
    user.makeChange("Single user content");

    // Wait for the change to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    const metadata = await get_metadata(opts);
    expect(metadata.id).toBe("test-doc");
    expect(metadata.peers.length).toBe(1);
    expect(metadata.peers[0].peer_id).toBe(user.doc.peerIdStr);
    expect(metadata.peers[0].user_id).toBe("single-user");

    user.connection.getWebSocket().close();
  });

  test("should return metadata for document with multiple users", async () => {
    // Create document with multiple users
    const {user: userA, opts: optsA } = await make_user({ userId: 'user-a' });
    const {user: userB, opts: optsB } = await make_user({ userId: 'user-b' });
    const {user: userC, opts: optsC } = await make_user({ userId: 'user-c' });

    userA.makeChange("Change from user A");
    userB.makeChange(" - Change from user B");
    userC.makeChange(" - Change from user C");

    // Wait for changes to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    const metadata = await get_metadata(optsA);

    expect(metadata.id).toBe("test-doc");
    expect(metadata.peers.length).toBe(3);

    // Verify all users are present
    const userIds = metadata.peers.map(p => p.user_id).sort();
    expect(userIds).toEqual(["user-a", "user-b", "user-c"]);

    // Verify peer IDs match
    const peerIds = metadata.peers.map(p => p.peer_id).sort();
    const expectedPeerIds = [
      userA.doc.peerIdStr,
      userB.doc.peerIdStr,
      userC.doc.peerIdStr
    ].sort();
    expect(peerIds).toEqual(expectedPeerIds);

    // Clean up connections
    userA.connection.getWebSocket().close();
    userB.connection.getWebSocket().close();
    userC.connection.getWebSocket().close();
  });

  test("should increment version ID after document changes and disconnect", async () => {
    let { user, opts } = await make_user({ userId: 'version-test-user'});
    //const user = await createTestUser(mf, "test-doc", { userId: "version-test-user" });
    //const { user, doc_name, opts } = make_user('test-doc', {
    let metadata_og = await get_metadata(opts);
    user.makeChange("Initial content for version test");

    // Wait and disconnect to trigger version increment
    await new Promise((resolve) => setTimeout(resolve, 100));
    user.connection.getWebSocket().close();

    // Wait for disconnect processing and version increment
    await new Promise((resolve) => setTimeout(resolve, 5000));

    let metadata = await get_metadata(opts);

    expect(metadata_og.version_id).toBe("");
    expect(metadata.version_id != metadata_og.version_id).toBe(true);
  }, 8000);

  test("should handle different permission levels in metadata", async () => {
    // Create users with different permission levels
    const owner = await createTestUser(mf, "test-doc", {
      userId: "owner-user",
      permissionLevel: "owner"
    });
    const editor = await createTestUser(mf, "test-doc", {
      userId: "editor-user",
      permissionLevel: "edit"
    });
    const viewer = await createTestUser(mf, "test-doc", {
      userId: "viewer-user",
      permissionLevel: "view"
    });

    owner.makeChange("Content from owner");
    editor.makeChange(" - Edit from editor");

    await new Promise((resolve) => setTimeout(resolve, 200));

    const token = getTokenForDocument("test-doc", "owner-user", "owner");

    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/metadata",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);

    const metadata = await response.json() as {
      id: string;
      peers: Array<{
        peer_id: string;
        user_id: string;
      }>;
      version_id: string;
    };

    expect(metadata.peers.length).toBe(3);

    // All users should be present regardless of permission level
    const userIds = metadata.peers.map(p => p.user_id).sort();
    expect(userIds).toEqual(["editor-user", "owner-user", "viewer-user"]);

    owner.connection.getWebSocket().close();
    editor.connection.getWebSocket().close();
    viewer.connection.getWebSocket().close();
  });

  test("should require authentication for metadata endpoint", async () => {
    // Create document
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("Protected metadata");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to fetch without token
    const responseWithoutAuth = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/metadata"
    );

    expect(responseWithoutAuth.status).toBe(401);

    // Try with invalid token
    const responseWithBadToken = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/metadata",
      {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      }
    );

    expect(responseWithBadToken.status).toBe(401);

    user.connection.getWebSocket().close();
  });

  test("should return 404 for non-existent document metadata", async () => {
    const token = getTokenForDocument("non-existent-doc", "test-user", "owner");

    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/non-existent-doc/metadata",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );
    console.log(await response.text());

    expect(response.status).toBe(404);
  });

  test("empty document with one peer", async () => {
    const token = getTokenForDocument("empty-doc", "test-user", "owner");

    const tempUser = await createTestUser(mf, "empty-doc");
    tempUser.connection.getWebSocket().close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/empty-doc/metadata",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);

    const metadata = await response.json() as {
      id: string;
      peers: Array<{
        peer_id: string;
        user_id: string;
      }>;
      version_id: string;
    };

    expect(metadata.id).toBe("empty-doc");
    expect(metadata.peers.length).toBe(1);
    expect(metadata.version_id).toBe("");
  }, 3000);
});
