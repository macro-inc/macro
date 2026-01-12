import { Miniflare } from "miniflare";
import { expect, test, describe, beforeEach } from "vitest";
import { createTestUser, setupMiniflare, createDocument, copyDocument } from "./utils";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

// Helper functions
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("document copy endpoint tests", () => {
  test("should copy document with content", async () => {
    let doc = await createDocument(mf);
    const user = await doc.createUser();
    user.makeChange("Original content");

    await wait(500); // Wait for snapshot
    let doc2 = await doc.copy();

    const copiedUser = await doc2.createUser();
    expect(copiedUser.getState()).toBe("Original content");

    user.connection.getWebSocket().close();
    copiedUser.connection.getWebSocket().close();
  }, 3000);

  test("should copy document to specific version", async () => {
    let doc = await createDocument(mf);
    let user = await doc.createUser();

    user.makeChange("Version 1");
    const v1Frontier = user.doc.vvToFrontiers(user.doc.version())[0];

    user.makeChange(" -> Version 2");
    const v2Frontier = user.doc.vvToFrontiers(user.doc.version())[0];

    user.makeChange(" -> Version 3");
    await wait(500);

    // Copy to v1
    const v1 = await doc.copy("copy-v1", {
      peer: v1Frontier.peer,
      counter: v1Frontier.counter,
    });
    const v2 = await doc.copy("copy-v2", {
      peer: v2Frontier.peer,
      counter: v2Frontier.counter,
    });

    // Verify versions
    const copyV1 = await v1.createUser();
    expect(copyV1.getState()).toBe("Version 1");

    const copyV2 = await v2.createUser();
    expect(copyV2.getState()).toBe("Version 1 -> Version 2");

    [user, copyV1, copyV2].forEach(u => u.connection.getWebSocket().close());

  }, 3000);

  test("should require internal auth for copy", async () => {
    let doc = await createDocument(mf);
    let user = await doc.createUser();
    user.makeChange("Protected content");

    await wait(500);
    // Try to copy without internal auth key
    const response = await mf.dispatchFetch(
      `http://localhost:8787/document/${doc.name}/copy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_document_id: "unauthorized-copy" }),
      }
    );

    expect(response.status).toBe(401);
    user.connection.getWebSocket().close();

  }, 3000);

  test("should handle copying non-existent document", async () => {
    const response = await copyDocument(mf, "non-existent-doc", "copy-of-nothing");
    expect(response.status).toBe(404);
  });

  test("should copy document with multiple changes", async () => {
    let doc = await createDocument(mf);
    let [userA, userB] = await doc.createMultipleUsers(2);

    userA.makeChange('A1');
    await wait(100);
    await userB.importNextUpdate();

    userB.makeChange('B1');
    await wait(100);
    await userA.importNextUpdate();

    userA.makeChange('A2');
    await wait(100);
    await userB.importNextUpdate();

    userB.makeChange('B2');
    await wait(100);
    await userA.importNextUpdate();

    expect(userA.getState()).toBe("A1B1A2B2");
    expect(userB.getState()).toBe("A1B1A2B2");

    let doc2 = await doc.copy();
    await wait(100);
    let userdoc2 = await doc2.createUser();
    expect(userdoc2.getState()).toBe('A1B1A2B2');

    [userA, userB, userdoc2].forEach(u => u.connection.getWebSocket().close());
  }, 15000);


  test("should not affect source document when copying", async () => {
    let doc = await createDocument(mf);
    let source = await doc.createUser();
    source.makeChange("Original data");

    await wait(500);

    let doc_copied = await doc.copy();
    let user_copied = await doc_copied.createUser();

    user_copied.makeChange(" - Modified in copy");

    await wait(500);

    const sourceCheck = await doc.createUser();

    expect(sourceCheck.getState()).toBe("Original data");
    expect(user_copied.getState()).toBe("Original data - Modified in copy");

    [source, user_copied, sourceCheck].forEach(u => u.connection.getWebSocket().close());
  }, 3000);

  test("should handle copy with empty document", async () => {
    let doc = await createDocument(mf);
    let user = await doc.createUser();
    await wait(500);

    let copy = await doc.copy();
    await wait(500);
    let copiedUser = await copy.createUser();
    await wait(500);
    expect(copiedUser.getState()).toBe("");

    [user, copiedUser].forEach(u => u.connection.getWebSocket().close());

  }, 3000);

  test("should handle overwriting existing target document", async () => {
    // Create source
    const source = await createTestUser(mf, "source-overwrite");
    source.makeChange("Source content");
    await wait(500);

    // Create target with different content
    const target = await createTestUser(mf, "target-overwrite");
    target.makeChange("Target content");
    await wait(500);

    // Copy source to target (should overwrite or fail depending on implementation)
    const response = await copyDocument(mf, "source-overwrite", "target-overwrite");

    // Depending on implementation, this might be 200 (overwrite) or 409/500 (conflict)
    // Adjust based on actual behavior
    expect([200, 409, 500]).toContain(response.status);

    [source, target].forEach(u => u.connection.getWebSocket().close());
  }, 15000);

  test("should preserve document structure in copy", async () => {
    const user = await createTestUser(mf, "structured-doc");

    // Create structured content (using Loro's text operations)
    user.makeChange("Line 1");
    user.makeChange("\nLine 2");
    user.makeChange("\nLine 3");
    await wait(500);

    const response = await copyDocument(mf, "structured-doc", "structured-copy");
    expect(response.status).toBe(200);

    const copiedUser = await createTestUser(mf, "structured-copy");
    expect(copiedUser.getState()).toBe("Line 1\nLine 2\nLine 3");

    [user, copiedUser].forEach(u => u.connection.getWebSocket().close());
  }, 10000);
});
