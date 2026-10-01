import { randomBytes } from "node:crypto";
import { TestDocument } from "./automerge";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, test } from "vitest";
import { MAX_CHUNK_SIZE } from "../../../packages/collaboration/src/websocket/platform/framing/frames";
import {
	FromPeer,
	InitializeFromSnapshotRequest,
} from "../bebop/generated/schema";
import { createTestUser, getTokenForDocument, setupMiniflare } from "./utils";

let mf: Miniflare;
const users: Awaited<ReturnType<typeof createTestUser>>[] = [];
beforeAll(async () => {
	mf = await setupMiniflare();
}, 60_000);
afterAll(async () => {
	for (const user of users)
		if (user.getWebSocket().readyState === 1) user.getWebSocket().close();
	await mf?.dispose();
});

test("large update batches, snapshots and reconnects use bounded wire frames", async () => {
	const id = crypto.randomUUID();
	const seed = new TestDocument();
	seed.getText("content").push("Chunked sync\n");
	seed.commit();
	const initialized = await mf.dispatchFetch(
		`http://localhost/document/${id}/initialize`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${getTokenForDocument(id, "owner", "owner")}`,
			},
			body: InitializeFromSnapshotRequest.encode({
				snapshot: seed.export({ mode: "snapshot" }),
			}),
		},
	);
	expect(initialized.status).toBe(200);
	const alice = await createTestUser(mf, id);
	const bob = await createTestUser(mf, id);
	users.push(alice, bob);
	const incoming: number[] = [];
	bob.getWebSocket().addEventListener("message", (event) => {
		if (typeof event.data !== "string") incoming.push(event.data.byteLength);
	});
	const text = randomBytes(1_800_000).toString("base64");
	const updates: Uint8Array[] = [];
	for (let offset = 0; offset < text.length; offset += 40_000) {
		const from = alice.doc.version();
		alice.doc.getText("content").push(text.slice(offset, offset + 40_000));
		alice.doc.commit();
		updates.push(alice.doc.export({ mode: "update", from }));
	}
	const message = FromPeer.fromPeerUpdate({
		updates,
		id: "large-update",
	}).encode();
	expect(message.byteLength).toBeGreaterThan(MAX_CHUNK_SIZE);
	alice.send(message);
	const ack = await alice.readNextMessage();
	expect(ack.isRemoteUpdateAck() && ack.value.id).toBe("large-update");
	for (const _ of updates) await bob.importNextUpdate();
	expect(bob.getState()).toBe(alice.getState());
	expect(incoming.length).toBe(updates.length);
	expect(Math.max(...incoming)).toBeLessThanOrEqual(MAX_CHUNK_SIZE + 1);

	const bobFrom = bob.doc.version();
	bob.doc.getText("content").push("\nSmall reverse edit");
	bob.doc.commit();
	bob.send(
		FromPeer.fromPeerUpdate({
			updates: [bob.doc.export({ mode: "update", from: bobFrom })],
			id: "small-update",
		}).encode(),
	);
	await alice.importNextUpdate();
	expect(alice.getState()).toBe(bob.getState());

	const snapshotFrames: number[] = [];
	alice.getWebSocket().addEventListener("message", (event) => {
		if (typeof event.data !== "string")
			snapshotFrames.push(event.data.byteLength);
	});
	alice.send(FromPeer.fromPeerRequestSnapshot({}).encode());
	const response = await alice.readNextMessage();
	expect(response.isRemoteSnapshot()).toBe(true);
	expect(snapshotFrames.length).toBeGreaterThan(1);
	expect(Math.max(...snapshotFrames)).toBeLessThanOrEqual(MAX_CHUNK_SIZE + 1);
	if (!response.isRemoteSnapshot()) throw new Error("Expected snapshot");
	const snapshot = new TestDocument();
	snapshot.import(response.value.snapshot);
	expect(snapshot.getText("content").toString()).toBe(alice.getState());

	bob.getWebSocket().close();
	const fresh = await createTestUser(mf, id);
	users.push(fresh);
	expect(fresh.getState()).toBe(alice.getState());
	fresh.send("ping");
	expect(await fresh.waitForNextMessage()).toBe("pong");
}, 60_000);
