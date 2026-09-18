import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc, VersionVector } from "loro-crdt";
import jwt from "jsonwebtoken";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	FromPeer,
	InitializeFromSnapshotRequest,
} from "../bebop/generated/schema";
import { createTestUser, getTokenForDocument, setupMiniflare } from "./utils";

type User = Awaited<ReturnType<typeof createTestUser>>;
let mf: Miniflare;
const users: User[] = [];
const persistPath = mkdtempSync(join(tmpdir(), "spreadsheet-atomic-"));
beforeAll(async () => {
	mf = await setupMiniflare({ persistPath });
}, 60_000);
afterAll(async () => {
	for (const user of users)
		if (user.getWebSocket().readyState === 1) user.getWebSocket().close();
	await mf?.dispose();
	rmSync(persistPath, { recursive: true, force: true });
});
const auth = (id: string, permission: "owner" | "edit" | "view" = "edit") => ({
	Authorization: `Bearer ${getTokenForDocument(id, "actor", permission)}`,
});
const url = (id: string, action: string) =>
	`http://localhost/document/${id}/spreadsheet-${action}`;
async function seed() {
	const id = crypto.randomUUID();
	const response = await mf.dispatchFetch(
		`http://localhost/document/${id}/initialize`,
		{
			method: "POST",
			headers: auth(id),
			body: InitializeFromSnapshotRequest.encode({
				snapshot: new Uint8Array(
					readFileSync("../../static_assets/spreadsheet-golden.1.bin"),
				),
			}),
		},
	);
	expect(response.status).toBe(200);
	return id;
}
async function snapshot(id: string) {
	const response = await mf.dispatchFetch(url(id, "snapshot"), {
		headers: auth(id, "view"),
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		snapshot: string;
		revision: string;
	};
	const doc = new LoroDoc();
	doc.import(Buffer.from(body.snapshot, "base64"));
	expect(
		VersionVector.decode(Buffer.from(body.revision, "base64")).toJSON(),
	).toEqual(doc.version().toJSON());
	return { ...body, doc };
}
function edit(
	source: Awaited<ReturnType<typeof snapshot>>,
	address = "A1",
	value = "42",
) {
	const from = source.doc.version();
	source.doc.getMap("spreadsheetValues").set(address, value);
	source.doc.commit();
	return {
		expectedRevision: source.revision,
		update: Buffer.from(source.doc.export({ mode: "update", from })).toString(
			"base64",
		),
	};
}
async function post(
	id: string,
	body: unknown,
	headers: Record<string, string> = auth(id),
) {
	return mf.dispatchFetch(url(id, "update"), {
		method: "POST",
		credentials: "omit",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("atomic native spreadsheet API", () => {
	it("returns a coherent authorized snapshot and rejects viewers, wrong-document grants, missing and invalid tokens", async () => {
		const id = await seed();
		const source = await snapshot(id);
		const update = edit(source);
		expect((await post(id, update, auth(id, "view"))).status).toBe(403);
		expect((await post(id, update, auth("wrong-document"))).status).toBe(401);
		expect(
			(await post(id, update, { "x-internal-auth-key": "local" })).status,
		).toBe(401);
		expect(
			(
				await post(id, update, {
					Authorization: "Bearer invalid",
					"x-internal-auth-key": "local",
				})
			).status,
		).toBe(401);
		expect(
			(
				await mf.dispatchFetch(url(id, "snapshot"), {
					headers: auth("wrong-document"),
				})
			).status,
		).toBe(401);
		expect(
			(await snapshot(id)).doc.getMap("spreadsheetValues").get("A1"),
		).toBeUndefined();
	});

	it("applies, broadcasts, and recognizes an already-applied retry without changing the revision", async () => {
		const id = await seed();
		const observer = await createTestUser(mf, id, {
			userId: "viewer",
			permissionLevel: "view",
		});
		users.push(observer);
		const request = edit(await snapshot(id));
		const response = await post(id, request);
		expect(response.status).toBe(200);
		const committed = (await response.json()) as {
			revision: string;
			applied: boolean;
		};
		expect(committed.applied).toBe(true);
		for (;;) {
			const message = await observer.readNextMessage();
			if (message.isRemoteUpdate()) {
				observer.doc.import(message.value.update);
				break;
			}
		}
		expect(observer.doc.getMap("spreadsheetValues").get("A1")).toBe("42");
		const retry = await post(id, request);
		expect(retry.status).toBe(200);
		expect(await retry.json()).toEqual({
			revision: committed.revision,
			applied: false,
		});
		const noOpSource = await snapshot(id);
		const noOp = Buffer.from(
			noOpSource.doc.export({ mode: "update", from: noOpSource.doc.version() }),
		).toString("base64");
		const noOpResponse = await post(id, {
			expectedRevision: noOpSource.revision,
			update: noOp,
		});
		expect(noOpResponse.status).toBe(200);
		expect(await noOpResponse.json()).toEqual({
			revision: committed.revision,
			applied: false,
		});
	});

	it("allows one of two concurrent CAS writes and preserves the rejected target", async () => {
		const id = await seed();
		const left = edit(await snapshot(id), "A1", "left");
		const right = edit(await snapshot(id), "B1", "right");
		const responses = await Promise.all([post(id, left), post(id, right)]);
		expect(responses.map((response) => response.status).sort()).toEqual([
			200, 409,
		]);
		const state = (await snapshot(id)).doc.getMap("spreadsheetValues").toJSON();
		expect(state).toEqual(
			responses[0].status === 200 ? { A1: "left" } : { B1: "right" },
		);
	});

	it("compares against websocket edits and leaves stale writes unapplied", async () => {
		const id = await seed();
		const request = edit(await snapshot(id), "B1", "stale");
		const writer = await createTestUser(mf, id, {
			userId: "human",
			permissionLevel: "edit",
		});
		users.push(writer);
		writer.doc.getMap("spreadsheetValues").set("A1", "human");
		writer.doc.commit();
		const operationId = crypto.randomUUID();
		writer.send(
			FromPeer.fromPeerUpdate({
				updates: [writer.doc.export({ mode: "update" })],
				id: operationId,
			}).encode(),
		);
		for (;;) {
			const message = await writer.readNextMessage();
			if (message.isRemoteUpdateAck() && message.value.id === operationId)
				break;
		}
		expect((await post(id, request)).status).toBe(409);
		expect(
			(await snapshot(id)).doc.getMap("spreadsheetValues").toJSON(),
		).toEqual({ A1: "human" });
	});

	it("rejects unsupported roots, schemas, snapshot bodies, malformed input, and oversized payloads atomically", async () => {
		const id = await seed();
		for (const [root, key, value] of [
			["root", "content", "no"],
			["spreadsheetValues", "AA1", "no"],
			["spreadsheetValues", "A1", "x".repeat(10_001)],
			["spreadsheetFormats", "A1", "unsupported"],
		]) {
			const source = await snapshot(id);
			const from = source.doc.version();
			source.doc.getMap(root).set(key, value);
			source.doc.commit();
			expect(
				(
					await post(id, {
						expectedRevision: source.revision,
						update: Buffer.from(
							source.doc.export({ mode: "update", from }),
						).toString("base64"),
					})
				).status,
			).toBe(400);
		}
		const original = await snapshot(id);
		expect(
			(
				await post(id, {
					expectedRevision: original.revision,
					update: original.snapshot,
				})
			).status,
		).toBe(400);
		expect(
			(await post(id, { expectedRevision: "not-base64", update: "no" })).status,
		).toBe(400);
		expect(
			(
				await post(id, {
					expectedRevision: original.revision,
					update: Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64"),
				})
			).status,
		).toBe(413);
		expect((await snapshot(id)).revision).toBe(original.revision);
		const plainId = crypto.randomUUID();
		const initialized = await mf.dispatchFetch(
			`http://localhost/document/${plainId}/initialize`,
			{
				method: "POST",
				headers: auth(plainId),
				body: InitializeFromSnapshotRequest.encode({
					snapshot: new Uint8Array(
						readFileSync("../../static_assets/markdown-golden.1.bin"),
					),
				}),
			},
		);
		expect(initialized.status).toBe(200);
		expect(
			(
				await mf.dispatchFetch(url(plainId, "snapshot"), {
					headers: auth(plainId),
				})
			).status,
		).toBe(400);
	});

	it("stores signed actor metadata with the oplog and ignores body attribution", async () => {
		const id = await seed();
		const request = edit(await snapshot(id));
		expect((await post(id, { ...request, actor: "forged" })).status).toBe(400);
		const token = jwt.sign(
			{
				document_id: id,
				user_id: "macro|real-user",
				access_level: "edit",
				actor: "bot|spreadsheet",
				exp: Math.floor(Date.now() / 1000) + 60,
			},
			"local",
		);
		expect(
			(await post(id, request, { Authorization: `Bearer ${token}` })).status,
		).toBe(200);
		const response = await mf.dispatchFetch(
			`http://localhost/document/${id}/debug_do_kv_list/actor`,
			{ headers: { "x-internal-auth-key": "local" } },
		);
		expect(response.status).toBe(200);
		const records = (await response.json()) as [string, number[]][];
		expect(records).toHaveLength(1);
		expect(JSON.parse(Buffer.from(records[0][1]).toString())).toEqual({
			actor: "bot|spreadsheet",
			on_behalf_of: "macro|real-user",
		});
	});

	it("persists a bounded delta larger than a single small KV value", async () => {
		const id = await seed();
		const source = await snapshot(id);
		const from = source.doc.version();
		for (let row = 1; row <= 100; row++)
			source.doc
				.getMap("spreadsheetValues")
				.set(`A${row}`, `${row}:` + "a".repeat(3000));
		source.doc.commit();
		const update = source.doc.export({ mode: "update", from });
		expect(update.length).toBeGreaterThan(128 * 1024);
		const response = await post(id, {
			expectedRevision: source.revision,
			update: Buffer.from(update).toString("base64"),
		});
		expect(response.status).toBe(200);
		expect(
			(await snapshot(id)).doc.getMap("spreadsheetValues").get("A100"),
		).toBe("100:" + "a".repeat(3000));
	});

	it("persists an acknowledged CAS update across worker restart", async () => {
		const id = await seed();
		const request = edit(await snapshot(id), "Z999", "=SUM(A1:B2)");
		const response = await post(id, request);
		expect(response.status).toBe(200);
		const saved = await response.json();
		for (const user of users.splice(0))
			if (user.getWebSocket().readyState === 1) user.getWebSocket().close();
		await mf.dispose();
		mf = await setupMiniflare({ persistPath, migrate: false });
		const restored = await snapshot(id);
		expect(restored.doc.getMap("spreadsheetValues").get("Z999")).toBe(
			"=SUM(A1:B2)",
		);
		const retry = await post(id, request);
		expect(await retry.json()).toEqual({ ...saved, applied: false });
	}, 30_000);
});
