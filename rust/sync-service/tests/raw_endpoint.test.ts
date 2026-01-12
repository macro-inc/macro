import { Miniflare } from "miniflare";
import { LoroDoc } from "loro-crdt";
import { expect, test, describe, beforeEach } from "vitest";
import { createTestUser, getTokenForDocument, setupMiniflare } from "./utils";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

describe("raw endpoint tests", async () => {
  test("should create document and fetch via raw endpoint", async () => {
    // Create a document with some content
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("Hello world from raw endpoint test!");

    // Wait for the change to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get token for API access
    const token = getTokenForDocument("test-doc", "test-user", "owner");

    // Fetch document via raw endpoint
    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/raw",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);

    // Parse the response - should be JSON containing the document data
    const rawData = await response.json();

    // Verify the response contains expected structure
    expect(rawData).toBeDefined();
    expect(typeof rawData).toBe("object");

    // Clean up
    user.connection.getWebSocket().close();
  });

  test("should fetch raw data for document with multiple changes", async () => {
    // Create document and make multiple changes
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("First change");
    user.makeChange(" - Second change");
    user.makeChange(" - Third change");

    // Wait for changes to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    const token = getTokenForDocument("test-doc", "test-user", "owner");

    // Fetch raw data
    const response = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/raw",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);

    const rawData = await response.json();
    expect(rawData).toBeDefined();

    // Verify document state matches what we expect
    expect(user.getState()).toBe("First change - Second change - Third change");

    user.connection.getWebSocket().close();
  });

  test("should require authentication for raw endpoint", async () => {
    // Create document
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("Protected content");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Try to fetch without token
    const responseWithoutAuth = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/raw"
    );

    expect(responseWithoutAuth.status).toBe(401);

    // Try with invalid token
    const responseWithBadToken = await mf.dispatchFetch(
      "http://localhost:8787/document/test-doc/raw",
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
      "http://localhost:8787/document/non-existent-doc/raw",
      {
        headers: {
          Authorization: "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(404);
  });
});
