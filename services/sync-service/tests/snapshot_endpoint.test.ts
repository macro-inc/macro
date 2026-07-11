import { Miniflare } from "miniflare";
import { LoroDoc } from "loro-crdt";
import { expect, test, describe, beforeEach } from "vitest";
import { createTestUser, getTokenForDocument, setupMiniflare } from "./utils";

const l = (...x) => [x[0], console.log(...x)][0];
let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

describe("snapshot endpoint tests", async () => {
  test("should create document and fetch via snapshot endpoint", async () => {
    // Create a document with some content
    const user = await createTestUser(mf, "test-doc");
    const HELLO_MSG = 'hello world test snapshots';
    user.makeChange(HELLO_MSG);

    // Wait for the change to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get token for API access
    const token = getTokenForDocument("test-doc", "test-user", "owner");

    // Fetch document via raw endpoint
    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/snapshot",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);

    const rawData = await response.arrayBuffer();
    let doc = new LoroDoc();
    doc.import(Buffer.from(rawData));
    expect(l(doc.getText('content').toString()), HELLO_MSG);

    // Clean up
    user.connection.getWebSocket().close();
  });

  test("should fetch snapshot for document with multiple changes", async () => {
    // Create document and make multiple changes
    const user = await createTestUser(mf, "test-doc");
    let changes = [
    "First change",
    " - Second change",
    " - Third change",
    ];
    user.makeChange(changes[0]);
    user.makeChange(changes[1]);
    user.makeChange(changes[2]);

    // Wait for changes to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    const token = getTokenForDocument("test-doc", "test-user", "owner");

    // Fetch raw data
    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/snapshot",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);
    const rawData = await response.arrayBuffer();
    let doc = new LoroDoc();
    doc.import(Buffer.from(rawData));
    expect(l(doc.getText('content').toString()), changes.join(''));

    user.connection.getWebSocket().close();
  });

  test("should require authentication for snapshot endpoint", async () => {
    // Create document
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("Protected content");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to fetch without token
    const responseWithoutAuth = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/snapshot"
    );

    expect(responseWithoutAuth.status).toBe(401);

    // Try with invalid token
    const responseWithBadToken = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/snapshot",
      {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      }
    );

    expect(responseWithBadToken.status).toBe(401);

    user.connection.getWebSocket().close();
  });

  test("should return 404 for non-existent document", async () => {
    const token = getTokenForDocument("non-existent-doc", "test-user", "owner");

    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/non-existent-doc/snapshot",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(404);
  });
});
