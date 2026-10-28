import { Miniflare } from "miniflare";
import { LoroDoc } from "loro-crdt";
import { beforeEach, describe, expect, test } from "vitest";
import {
  INTERNAL_API_SECRET,
  createTestUser,
  getTokenForDocument,
  setupMiniflare,
  sleep,
} from "./utils";

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

const documentUrl = (documentId: string, operation: string) =>
  `http://localhost:8787/document/${documentId}/${operation}`;

const internalHeaders = { "x-internal-auth-key": INTERNAL_API_SECRET };

const deleteDocument = (
  documentId: string,
  headers: Record<string, string> = internalHeaders,
  method = "DELETE",
) => mf.dispatchFetch(documentUrl(documentId, "delete"), { method, headers });

const existsStatus = async (documentId: string) =>
  (await mf.dispatchFetch(documentUrl(documentId, "exists"))).status;

const rawContent = async (documentId: string) => {
  const token = getTokenForDocument(documentId, "test-user", "owner");
  const response = await mf.dispatchFetch(documentUrl(documentId, "raw"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.text() };
};

const rowCount = async (table: "peer_user_map" | "blame", documentId: string) => {
  const db = await mf.getD1Database("USER_PEER_MAPPING");
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id = ?`)
    .bind(documentId)
    .first<{ n: number }>();
  return row?.n;
};

const insertBlame = async (documentId: string) => {
  const db = await mf.getD1Database("USER_PEER_MAPPING");
  await db
    .prepare(
      "INSERT INTO blame (document_id, node_id, peer_id, timestamp_ms) VALUES (?, 'node', '1', 0)",
    )
    .bind(documentId)
    .run();
};

describe("delete endpoint", () => {
  test("requires the internal key", async () => {
    const user = await createTestUser(mf, "doc");
    const ownerToken = getTokenForDocument("doc", "test-user", "owner");

    expect((await deleteDocument("doc", {})).status).toBe(401);
    expect((await deleteDocument("doc", { Authorization: `Bearer ${ownerToken}` })).status).toBe(401);
    expect((await deleteDocument("doc", { "x-internal-auth-key": "wrong" })).status).toBe(401);
    expect(await existsStatus("doc")).toBe(200);

    user.connection.getWebSocket().close();
  });

  test("rejects methods other than DELETE", async () => {
    expect((await deleteDocument("doc", internalHeaders, "POST")).status).toBe(405);
  });

  test("erases the document's session, peers, and blame without touching others", async () => {
    const user = await createTestUser(mf, "doc", { userId: "user-a" });
    user.makeChange("confidential");
    const other = await createTestUser(mf, "other", { userId: "user-b" });
    other.makeChange("kept");
    await sleep(200);
    await insertBlame("doc");
    await insertBlame("other");

    expect((await rawContent("doc")).body).toContain("confidential");
    expect(await rowCount("peer_user_map", "doc")).toBe(1);

    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      user.connection
        .getWebSocket()
        .addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason })),
    );

    expect((await deleteDocument("doc")).status).toBe(200);
    expect(await closed).toEqual({ code: 1008, reason: "document deleted" });

    expect(await existsStatus("doc")).toBe(404);
    expect((await rawContent("doc")).status).toBe(404);
    expect(await rowCount("peer_user_map", "doc")).toBe(0);
    expect(await rowCount("blame", "doc")).toBe(0);

    expect(await existsStatus("other")).toBe(200);
    expect((await rawContent("other")).body).toContain("kept");
    expect(await rowCount("peer_user_map", "other")).toBe(1);
    expect(await rowCount("blame", "other")).toBe(1);

    // A new session must not replay the deleted operation log.
    const reconnected = await createTestUser(mf, "doc", { userId: "user-a" });
    expect(reconnected.getState()).toBe("");

    reconnected.connection.getWebSocket().close();
    other.connection.getWebSocket().close();
  });

  test("removes the KV fallback snapshot", async () => {
    const doc = new LoroDoc();
    doc.getText("content").insert(0, "from kv");
    const kv = await mf.getKVNamespace("SNAPSHOT_STORE_KV");
    await kv.put("legacy/legacy.snapshot", doc.export({ mode: "snapshot" }));
    expect(await existsStatus("legacy")).toBe(200);

    expect((await deleteDocument("legacy")).status).toBe(200);

    expect(await kv.get("legacy/legacy.snapshot")).toBeNull();
    expect(await existsStatus("legacy")).toBe(404);
  });

  test("succeeds for a document that never had a session", async () => {
    expect((await deleteDocument("never-synced")).status).toBe(200);
    expect((await deleteDocument("never-synced")).status).toBe(200);
    expect(await existsStatus("never-synced")).toBe(404);
  });
});
