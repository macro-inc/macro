import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
	FromPeer,
	FromRemote,
	InitializeFromSnapshotRequest,
} from "../bebop/generated/schema";
import {
	createTestWebSocket,
	getTokenForDocument,
	getTokenForSurface,
	setupMiniflare,
} from "./utils";

type Proof = {
	operation_id: string;
	source_id: string | null;
	digest: string;
	content_digest: string;
	revision: [string, number][];
	oplog_revision: [string, number][];
};
type Export = { proof: Proof; snapshot: number[] };
let mf: Miniflare;
const persistPath = mkdtempSync(join(tmpdir(), "surface-migration-"));
beforeAll(async () => {
	mf = await setupMiniflare({ persistPath });
}, 60_000);
afterAll(async () => {
	await mf?.dispose();
	rmSync(persistPath, { recursive: true, force: true });
});
async function restart(): Promise<void> {
	await mf.dispose();
	mf = await setupMiniflare({ persistPath, migrate: false });
}
async function post(
	kind: string,
	id: string,
	operation: string,
	body: unknown,
	stop?: string,
): ReturnType<Miniflare["dispatchFetch"]> {
	return mf.dispatchFetch(`http://localhost/${kind}/${id}/${operation}`, {
		method: "POST",
		headers: {
			"x-internal-auth-key": "local",
			"Content-Type": "application/json",
			...(stop ? { "x-sync-test-stop-after": stop } : {}),
		},
		body: JSON.stringify(body),
	});
}
async function seed(id: string): Promise<void> {
	const doc = new LoroDoc();
	doc.getText("content").push("original");
	const response = await mf.dispatchFetch(
		`http://localhost/document/${id}/initialize`,
		{
			method: "POST",
			headers: { "x-internal-auth-key": "local" },
			body: InitializeFromSnapshotRequest.encode({
				snapshot: doc.export({ mode: "snapshot" }),
			}),
		},
	);
	doc.free();
	expect(response.status).toBe(200);
}
async function connect(
	kind: "surface" | "document",
	id: string,
): ReturnType<Miniflare["dispatchFetch"]> {
	const token =
		kind === "surface"
			? getTokenForSurface(id)
			: getTokenForDocument(id, "writer", "edit");
	return mf.dispatchFetch(
		`http://localhost/${kind}/${id}/connect?token=${token}`,
		{ headers: { Upgrade: "websocket" } },
	);
}
async function freeze(
	id: string,
	operation_id = crypto.randomUUID(),
): Promise<Export> {
	const response = await post("document", id, "migration/freeze", {
		operation_id,
	});
	expect(response.status).toBe(200);
	return response.json<Export>();
}
function text(snapshot: number[]): string {
	const doc = new LoroDoc();
	doc.import(new Uint8Array(snapshot));
	const value = doc.getText("content").toString();
	doc.free();
	return value;
}

test("freeze drains acknowledged and racing edits, closes writers, and replays pending logs after restart", async () => {
	const id = crypto.randomUUID();
	await seed(id);
	const connected = await connect("document", id);
	const ws = connected.webSocket!;
	const socket = createTestWebSocket(ws);
	const closed = new Promise<number>((resolve) =>
		ws.addEventListener("close", (event) => resolve(event.code)),
	);
	ws.accept();
	const initial = FromRemote.decode(
		new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer),
	);
	if (!initial.isRemoteInitialSync()) throw new Error("missing initial sync");
	const doc = new LoroDoc();
	doc.import(initial.value.snapshot);
	function edit(value: string): void {
		doc.getText("content").push(value);
		socket.send(
			FromPeer.fromPeerUpdate({
				updates: [doc.export({ mode: "update" })],
				id: crypto.randomUUID(),
			}).encode(),
		);
	}
	edit(" acknowledged");
	expect(
		FromRemote.decode(
			new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer),
		).isRemoteUpdateAck(),
	).toBe(true);
	edit(" racing");
	const exported = await freeze(id);
	expect(text(exported.snapshot)).toMatch(/^original acknowledged( racing)?$/);
	// If the racing mutation is acknowledged, it must be present in the export.
	const racing = await socket.waitForNextMessage(100).catch(() => undefined);
	if (racing)
		expect(text(exported.snapshot)).toBe("original acknowledged racing");
	expect((await connect("document", id)).status).toBe(403);
	await restart();
	expect(await closed).toBe(1008);
	expect(await freeze(id, exported.proof.operation_id)).toEqual(exported);
	expect((await post("surface", id, "import", exported)).status).toBe(200);
	expect((await connect("surface", id)).status).toBe(409);
	expect((await post("surface", id, "verify", exported.proof)).status).toBe(
		200,
	);
	expect((await post("surface", id, "activate", exported.proof)).status).toBe(
		200,
	);
	expect(
		(await post("document", id, "migration/thaw", exported.proof)).status,
	).toBe(409);
	expect(
		(await post("document", id, "migration/retire", exported.proof)).status,
	).toBe(200);
	await restart();
	expect((await connect("document", id)).status).toBe(403);
	expect(
		(await post("document", id, "migration/thaw", exported.proof)).status,
	).toBe(409);
	const migrated = await connect("surface", id);
	expect(migrated.status).toBe(101);
	migrated.webSocket!.accept();
	migrated.webSocket!.close();
	expect((await post("surface", id, "revoke", {})).status).toBe(200);
	await restart();
	expect((await connect("surface", id)).status).toBe(403);
	expect((await post("surface", id, "import", exported)).status).toBe(403);
	doc.free();
}, 30_000);

test("verified rollback is allowed only before sealing; stale operations and conflicting targets fail closed", async () => {
	const id = crypto.randomUUID();
	await seed(id);
	const exported = await freeze(id);
	expect((await post("surface", id, "import", exported)).status).toBe(200);
	expect((await post("surface", id, "import", exported)).status).toBe(200);
	expect(
		(
			await post("surface", id, "import", {
				...exported,
				proof: { ...exported.proof, operation_id: crypto.randomUUID() },
			})
		).status,
	).toBe(409);
	expect(
		(await post("surface", id, "import", { ...exported, snapshot: [1, 2, 3] }))
			.status,
	).toBe(400);
	expect(
		(await post("document", id, "migration/retire", exported.proof)).status,
	).toBe(409);
	expect(
		(
			await post("document", id, "migration/thaw", {
				...exported.proof,
				digest: "wrong",
			})
		).status,
	).toBe(409);
	expect(
		(await post("document", id, "migration/thaw", exported.proof)).status,
	).toBe(200);
	await restart();
	expect(
		(await post("document", id, "migration/thaw", exported.proof)).status,
	).toBe(200);
	expect((await post("surface", id, "activate", exported.proof)).status).toBe(
		409,
	);
	expect(
		(
			await post("document", id, "migration/freeze", {
				operation_id: exported.proof.operation_id,
			})
		).status,
	).toBe(409);
	const next = await freeze(id);
	expect(text(next.snapshot)).toBe("original");
	expect((await post("surface", id, "import", next)).status).toBe(409);
});

test("internal-only operations and missing sources never create blank replacement content", async () => {
	const id = crypto.randomUUID();
	expect(
		(
			await post("document", id, "migration/freeze", {
				operation_id: crypto.randomUUID(),
			})
		).status,
	).toBe(404);
	for (const [kind, operation] of [
		["document", "migration/freeze"],
		["document", "migration/thaw"],
		["document", "migration/seal"],
		["document", "migration/retire"],
		["surface", "import"],
		["surface", "verify"],
		["surface", "activate"],
		["surface", "initialize_verified"],
	]) {
		const response = await mf.dispatchFetch(
			`http://localhost/${kind}/${id}/${operation}`,
			{ method: "POST" },
		);
		expect(response.status).toBe(401);
	}
});

test("isolated initialization acknowledges only the identical verified operation and seed", async () => {
	const id = crypto.randomUUID();
	const doc = new LoroDoc();
	doc.getText("content").push("seed");
	const body = {
		operation_id: crypto.randomUUID(),
		snapshot: Array.from(doc.export({ mode: "snapshot" })),
	};
	const response = await post("surface", id, "initialize_verified", body);
	expect(response.status).toBe(200);
	const receipt = await response.json();
	await restart();
	expect(
		await (await post("surface", id, "initialize_verified", body)).json(),
	).toEqual(receipt);
	expect(
		(
			await post("surface", id, "initialize_verified", {
				...body,
				operation_id: crypto.randomUUID(),
			})
		).status,
	).toBe(409);
	doc.getText("content").push("different");
	expect(
		(
			await post("surface", id, "initialize_verified", {
				...body,
				snapshot: Array.from(doc.export({ mode: "snapshot" })),
			})
		).status,
	).toBe(409);
	doc.free();
});

test("cold freeze replays acknowledged operation logs and rollback preserves the original", async () => {
	const id = crypto.randomUUID();
	await seed(id);
	const response = await connect("document", id);
	const ws = response.webSocket!;
	const socket = createTestWebSocket(ws);
	ws.accept();
	const initial = FromRemote.decode(
		new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer),
	);
	if (!initial.isRemoteInitialSync()) throw new Error("missing initial sync");
	const doc = new LoroDoc();
	doc.import(initial.value.snapshot);
	doc.getText("content").push(" pending");
	socket.send(
		FromPeer.fromPeerUpdate({
			updates: [doc.export({ mode: "update" })],
			id: crypto.randomUUID(),
		}).encode(),
	);
	expect(
		FromRemote.decode(
			new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer),
		).isRemoteUpdateAck(),
	).toBe(true);
	await restart();
	const exported = await freeze(id);
	expect(text(exported.snapshot)).toBe("original pending");
	expect(
		(await post("document", id, "migration/thaw", exported.proof)).status,
	).toBe(200);
	const original = await mf.dispatchFetch(
		`http://localhost/document/${id}/snapshot`,
		{
			method: "POST",
			headers: { "x-internal-auth-key": "local" },
		},
	);
	expect(text(Array.from(new Uint8Array(await original.arrayBuffer())))).toBe(
		"original pending",
	);
	doc.free();
});

test("competing freezes and activation versus rollback never yield two writable copies", async () => {
	const id = crypto.randomUUID();
	await seed(id);
	const results = await Promise.all([
		post("document", id, "migration/freeze", {
			operation_id: crypto.randomUUID(),
		}),
		post("document", id, "migration/freeze", {
			operation_id: crypto.randomUUID(),
		}),
	]);
	expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
	const exported = await results
		.find((response) => response.status === 200)!
		.json<Export>();
	expect((await post("surface", id, "import", exported)).status).toBe(200);
	const [activation, rollback] = await Promise.all([
		post("surface", id, "activate", exported.proof),
		post("document", id, "migration/thaw", exported.proof),
	]);
	expect([activation.status, rollback.status].sort()).toEqual([200, 409]);
	await restart();
	const source = await connect("document", id);
	const target = await connect("surface", id);
	expect(
		[source.status, target.status].filter((status) => status === 101),
	).toHaveLength(1);
	for (const response of [source, target]) {
		response.webSocket?.accept();
		response.webSocket?.close();
	}
});

test("an occupied target and forged revision/digest are not overwritten", async () => {
	const id = crypto.randomUUID();
	await seed(id);
	const exported = await freeze(id);
	for (const changed of [
		{ digest: "bad" },
		{ content_digest: "bad" },
		{ revision: [] },
		{ oplog_revision: [] },
	]) {
		expect(
			(
				await post("surface", id, "import", {
					...exported,
					proof: { ...exported.proof, ...changed },
				})
			).status,
		).toBe(400);
	}
	const doc = new LoroDoc();
	doc.getText("content").push("unrelated target");
	const occupied = await mf.dispatchFetch(
		`http://localhost/surface/${id}/initialize`,
		{
			method: "POST",
			headers: { "x-internal-auth-key": "local" },
			body: InitializeFromSnapshotRequest.encode({
				snapshot: doc.export({ mode: "snapshot" }),
			}),
		},
	);
	expect(occupied.status).toBe(200);
	expect((await post("surface", id, "import", exported)).status).toBe(409);
	const snapshot = await mf.dispatchFetch(
		`http://localhost/surface/${id}/snapshot`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${getTokenForSurface(id)}` },
		},
	);
	expect(text(Array.from(new Uint8Array(await snapshot.arrayBuffer())))).toBe(
		"unrelated target",
	);
	doc.free();
});

test("retries after activation preserve subsequent acknowledged surface edits", async () => {
	const id = crypto.randomUUID();
	await seed(id);
	const exported = await freeze(id);
	expect((await post("surface", id, "import", exported)).status).toBe(200);
	expect((await post("surface", id, "activate", exported.proof)).status).toBe(
		200,
	);
	const response = await connect("surface", id);
	const ws = response.webSocket!;
	const socket = createTestWebSocket(ws);
	ws.accept();
	const initial = FromRemote.decode(
		new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer),
	);
	if (!initial.isRemoteInitialSync()) throw new Error("missing initial sync");
	const doc = new LoroDoc();
	doc.import(initial.value.snapshot);
	doc.getText("content").push(" after activation");
	socket.send(
		FromPeer.fromPeerUpdate({
			updates: [doc.export({ mode: "update" })],
			id: crypto.randomUUID(),
		}).encode(),
	);
	expect(
		FromRemote.decode(
			new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer),
		).isRemoteUpdateAck(),
	).toBe(true);
	await restart();
	expect((await post("surface", id, "import", exported)).status).toBe(200);
	expect((await post("surface", id, "activate", exported.proof)).status).toBe(
		200,
	);
	const snapshot = await mf.dispatchFetch(
		`http://localhost/surface/${id}/snapshot`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${getTokenForSurface(id)}` },
		},
	);
	expect(text(Array.from(new Uint8Array(await snapshot.arrayBuffer())))).toBe(
		"original after activation",
	);
	doc.free();
});

// Run with a migration-test-hooks worker build to inject a crash immediately
// after each durable write. Production builds do not recognize this header.
const faultTests =
	process.env.SYNC_MIGRATION_FAULT_TESTS === "1" ? test : test.skip;
faultTests.each([
	"source_claim",
	"source_export",
	"source_frozen",
	"target_claim",
	"target_snapshot",
	"target_verified",
	"source_sealed",
	"target_active",
	"target_ready",
	"source_retired",
	"source_thawed",
])(
	"recovers after persistence boundary %s",
	async (boundary) => {
		const id = crypto.randomUUID();
		const operation_id = crypto.randomUUID();
		await seed(id);
		if (
			boundary.startsWith("source_") &&
			["source_claim", "source_export", "source_frozen"].includes(boundary)
		) {
			expect(
				(
					await post(
						"document",
						id,
						"migration/freeze",
						{ operation_id },
						boundary,
					)
				).status,
			).toBe(500);
			await restart();
		}
		const exported = await freeze(id, operation_id);
		if (boundary === "source_thawed") {
			expect(
				(await post("document", id, "migration/thaw", exported.proof, boundary))
					.status,
			).toBe(500);
			await restart();
			expect(
				(await post("document", id, "migration/thaw", exported.proof)).status,
			).toBe(200);
			expect(
				(await post("document", id, "migration/seal", exported.proof)).status,
			).toBe(409);
			return;
		}
		if (
			["target_claim", "target_snapshot", "target_verified"].includes(boundary)
		) {
			expect(
				(await post("surface", id, "import", exported, boundary)).status,
			).toBe(500);
			await restart();
			// The old initializer cannot steal a claimed-but-not-yet-written target.
			expect((await post("surface", id, "initialize", {})).status).toBe(409);
		}
		expect((await post("surface", id, "import", exported)).status).toBe(200);
		if (["source_sealed", "target_active", "target_ready"].includes(boundary)) {
			expect(
				(await post("surface", id, "activate", exported.proof, boundary))
					.status,
			).toBe(500);
			await restart();
			expect(
				(await post("document", id, "migration/thaw", exported.proof)).status,
			).toBe(409);
		}
		expect((await post("surface", id, "activate", exported.proof)).status).toBe(
			200,
		);
		if (boundary === "source_retired") {
			expect(
				(
					await post(
						"document",
						id,
						"migration/retire",
						exported.proof,
						boundary,
					)
				).status,
			).toBe(500);
			await restart();
		}
		expect(
			(await post("document", id, "migration/retire", exported.proof)).status,
		).toBe(200);
		expect(await freeze(id, operation_id)).toEqual(exported);
		expect((await connect("document", id)).status).toBe(403);
	},
	30_000,
);
