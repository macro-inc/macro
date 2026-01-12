import { Miniflare } from "miniflare";
import { expect, test, describe, beforeEach } from "vitest";
import { log, createTestUser, getTokenForDocument, INTERNAL_API_SECRET, setupMiniflare, sleep } from "./utils";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

// Helper functions

const admin_headers = { 'x-internal-auth-key': INTERNAL_API_SECRET };

const callEndpoint = (path: string,  docId: string, headers) => {
  return mf.dispatchFetch(`http://localhost:8787/document/${docId}/${path}`, { headers });
};

const callDebugEndpoint = (docId: string, headers = {...admin_headers}) => {
  return callEndpoint('debug_dump_operations', docId, headers);
};

const callWakeupEndpoint = (docId: string, headers = {...admin_headers}) => {
  return callEndpoint('wakeup', docId, headers);
};

const expectValidDebugResponse = async (response: Response) => {
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(Array.isArray(data)).toBe(true);
  return data;
};

describe("debug endpoint tests", async () => {
  test("should return KV dump with admin auth", async () => {
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("Debug test content");
    await sleep(200);

    const response = await callDebugEndpoint("test-doc");
    const debugData = await expectValidDebugResponse(response);

    console.log("Debug data entries:", debugData.length);
    user.connection.getWebSocket().close();
  });

  test("should require admin authentication", async () => {
    const user = await createTestUser(mf, "test-doc");
    user.makeChange("Protected content");
    await sleep(100);

    // Without admin key
    const response = await callDebugEndpoint("test-doc", {});
    expect(response.status).toBe(401);

    user.connection.getWebSocket().close();
  });

  test("should return 404 for non-existent document", async () => {
    const response = await callDebugEndpoint("missing-doc");
    expect(response.status).toBe(404);
  });

  test("should show KV contents after multiple operations", async () => {
    const [userA, userB] = await Promise.all([
      createTestUser(mf, "multi-doc", { userId: "user-a" }),
      createTestUser(mf, "multi-doc", { userId: "user-b" })
    ]);

    userA.makeChange("Op 1");
    userB.makeChange(" - Op 2");
    userA.makeChange(" - Op 3");
    await sleep(300);

    const response = await callDebugEndpoint("multi-doc");
    const debugData = await expectValidDebugResponse(response);

    expect(debugData.length).toBeGreaterThan(0);
    console.log("Multi-op debug entries:", debugData.length);

    [userA, userB].forEach(user => user.connection.getWebSocket().close());
  });

  test("should handle empty document", async () => {
    const user = await createTestUser(mf, "empty-doc");
    user.connection.getWebSocket().close();
    await sleep(100);

    const response = await callDebugEndpoint("empty-doc");
    const debugData = await expectValidDebugResponse(response);

    console.log("Empty doc debug entries:", debugData.length);
  });
});
describe("wakeup endpoint tests", async () => {
  test("test wakeup", async () => {
    const user = await createTestUser(mf, "empty-doc");
    user.connection.getWebSocket().close();
    await sleep(1000);

    let first = await (await callWakeupEndpoint("empty-doc")).json();
    expect(first).toBeNull();
    let [_tid, duration] = await(await callWakeupEndpoint("empty-doc")).json();
    expect(duration).toBe(60 * 1000);
  })
});
