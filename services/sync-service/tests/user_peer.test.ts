import { Miniflare } from "miniflare";
import { test, describe, beforeAll, expect } from "vitest";
import { createTestUser, getTokenForDocument, setupMiniflare } from "./utils";

let mf: Miniflare;

beforeAll(async () => {
  mf = await setupMiniflare();
});

describe("user to peer ID association tests", () => {
  test("should store user id to peer id mapping", async () => {
    const wsA = await createTestUser(mf, "test");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const token = getTokenForDocument("test", "test-user", "owner");

    let response = await mf.dispatchFetch(
      `http://localhost:8787/document/test/peer/${wsA.doc.peerId}`,
      {
        headers: {
          "Authorization": "Bearer " + token,
        },
      }
    );

    expect(response.status).toBe(200);
    let json = (await response.json()) as { peer_id: string; user_id: string };
    expect(json.peer_id).toBe(wsA.doc.peerIdStr);
    expect(json.user_id).toBe("test-user");
  });
});
