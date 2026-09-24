import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, test } from "vitest";
import { InitializeFromSnapshotRequest } from "../bebop/generated/schema";
import { getTokenForSurface, setupMiniflare } from "./utils";

let mf: Miniflare;
const persistPath = mkdtempSync(join(tmpdir(), "surface-recovery-"));
beforeAll(async () => {
	mf = await setupMiniflare({ persistPath });
}, 60_000);
afterAll(async () => {
	await mf?.dispose();
	rmSync(persistPath, { recursive: true, force: true });
});

function seed(content: string): Uint8Array {
	const doc = new LoroDoc();
	doc.getText("content").insert(0, content);
	const snapshot = doc.export({ mode: "snapshot" });
	doc.free();
	return snapshot;
}

async function initialize(id: string, snapshot: Uint8Array, stop = false) {
	return mf.dispatchFetch(`http://localhost/surface/${id}/initialize`, {
		method: "POST",
		headers: {
			"x-internal-auth-key": "local",
			...(stop ? { "x-sync-test-stop-after": "surface_snapshot" } : {}),
		},
		body: InitializeFromSnapshotRequest.encode({ snapshot }),
	});
}

async function exists(id: string): Promise<number> {
	return (
		await mf.dispatchFetch(`http://localhost/surface/${id}/exists`, {
			headers: { Authorization: `Bearer ${getTokenForSurface(id)}` },
		})
	).status;
}

async function content(id: string): Promise<string> {
	const response = await mf.dispatchFetch(`http://localhost/surface/${id}/snapshot`, {
		method: "POST",
		headers: { Authorization: `Bearer ${getTokenForSurface(id)}` },
	});
	expect(response.status).toBe(200);
	const doc = new LoroDoc();
	doc.import(new Uint8Array(await response.arrayBuffer()));
	const text = doc.getText("content").toString();
	doc.free();
	return text;
}

async function restart(): Promise<void> {
	await mf.dispose();
	mf = await setupMiniflare({ persistPath, migrate: false });
}

test("pending legacy snapshot resumes only for the identical seed", async () => {
	const id = crypto.randomUUID();
	const snapshot = seed("original");
	const kv = await mf.getKVNamespace("SNAPSHOT_STORE_KV");
	await kv.put(`surface:${id}/surface:${id}.snapshot`, snapshot);
	expect(await exists(id)).toBe(409);
	expect((await initialize(id, snapshot)).status).toBe(200);
	expect(await content(id)).toBe("original");
	await restart();
	expect(await exists(id)).toBe(200);
	expect((await initialize(id, seed("replacement"))).status).toBe(409);
	expect(await content(id)).toBe("original");
});

test("unidentified pending snapshot is rolled back including its KV fallback", async () => {
	const id = crypto.randomUUID();
	const kv = await mf.getKVNamespace("SNAPSHOT_STORE_KV");
	const key = `surface:${id}/surface:${id}.snapshot`;
	await kv.put(key, seed("orphan"));
	const snapshot = seed("replacement");
	expect((await initialize(id, snapshot)).status).toBe(409);
	expect(await kv.get(key)).toBeNull();
	expect(await exists(id)).toBe(409);
	await restart();
	expect((await initialize(id, snapshot)).status).toBe(200);
	expect(await content(id)).toBe("replacement");
});

const faultTests = process.env.SYNC_MIGRATION_FAULT_TESTS === "1" ? test : test.skip;
faultTests.each([false, true])(
	"snapshot committed before Ready failure recovers (restart: %s)",
	async (cold) => {
		const id = crypto.randomUUID();
		const snapshot = seed("durable seed");
		expect((await initialize(id, snapshot, true)).status).toBe(500);
		expect(await exists(id)).toBe(409);
		if (cold) await restart();
		expect((await initialize(id, snapshot)).status).toBe(200);
		expect(await content(id)).toBe("durable seed");
		await restart();
		expect(await exists(id)).toBe(200);
	},
);

faultTests("conflicting retry rolls back SQL and KV snapshots before a new seed", async () => {
	const id = crypto.randomUUID();
	const original = seed("original");
	expect((await initialize(id, original, true)).status).toBe(500);
	const kv = await mf.getKVNamespace("SNAPSHOT_STORE_KV");
	const key = `surface:${id}/surface:${id}.snapshot`;
	await kv.put(key, original);
	const replacement = seed("replacement");
	expect((await initialize(id, replacement)).status).toBe(409);
	expect(await kv.get(key)).toBeNull();
	await restart();
	expect((await initialize(id, replacement)).status).toBe(200);
	expect(await content(id)).toBe("replacement");
});
