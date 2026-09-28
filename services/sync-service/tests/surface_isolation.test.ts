import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import { createFetchMock, type Miniflare } from "miniflare";
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
	sleep,
} from "./utils";

let mf: Miniflare;
const persistPath = mkdtempSync(join(tmpdir(), "surface-isolation-"));
type TestClient = {
	socket: ReturnType<typeof createTestWebSocket>;
	doc: LoroDoc;
	closed: Promise<number>;
};
const effects: string[] = [];
const fetchMock = createFetchMock();
fetchMock.disableNetConnect();
for (const method of ["POST", "PUT"]) {
	fetchMock
		.get("https://dss.test")
		.intercept({ path: /.*/, method })
		.reply(200, (options) => {
			effects.push(options.path);
			return "";
		})
		.persist();
}
beforeAll(async () => {
	mf = await setupMiniflare({ persistPath, fetchMock });
}, 60_000);
afterAll(async () => {
	await mf?.dispose();
	rmSync(persistPath, { recursive: true, force: true });
});

function url(
	kind: "document" | "surface",
	id: string,
	operation: string,
): string {
	return `http://localhost/${kind}/${id}/${operation}`;
}
function token(kind: "document" | "surface", id: string): string {
	return kind === "surface"
		? getTokenForSurface(id)
		: getTokenForDocument(id, "document-user", "edit");
}
async function initialize(
	kind: "document" | "surface",
	id: string,
	content: string,
): Promise<number> {
	const doc = new LoroDoc();
	doc.getText("content").insert(0, content);
	const body = InitializeFromSnapshotRequest.encode({
		snapshot: doc.export({ mode: "snapshot" }),
	});
	doc.free();
	const response = await mf.dispatchFetch(url(kind, id, "initialize"), {
		method: "POST",
		headers: { "x-internal-auth-key": "local" },
		body,
	});
	return response.status;
}
async function connect(
	kind: "document" | "surface",
	id: string,
	grant = token(kind, id),
): ReturnType<Miniflare["dispatchFetch"]> {
	return mf.dispatchFetch(`${url(kind, id, "connect")}?token=${grant}`, {
		headers: { Upgrade: "websocket" },
	});
}
async function client(
	kind: "document" | "surface",
	id: string,
	grant = token(kind, id),
): Promise<TestClient> {
	const response = await connect(kind, id, grant);
	expect(response.status).toBe(101);
	const ws = response.webSocket!;
	const socket = createTestWebSocket(ws);
	const closed = new Promise<number>((resolve) =>
		ws.addEventListener("close", (event) => resolve(event.code)),
	);
	ws.accept();
	const message = FromRemote.decode(
		new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer),
	);
	expect(message.isRemoteInitialSync()).toBe(true);
	if (!message.isRemoteInitialSync())
		throw new Error("missing initial snapshot");
	const doc = new LoroDoc();
	doc.import(message.value.snapshot);
	return { socket, doc, closed };
}
async function content(
	kind: "document" | "surface",
	id: string,
): Promise<string> {
	const response = await mf.dispatchFetch(url(kind, id, "snapshot"), {
		method: "POST",
		headers: { Authorization: `Bearer ${token(kind, id)}` },
	});
	expect(response.status).toBe(200);
	const doc = new LoroDoc();
	doc.import(new Uint8Array(await response.arrayBuffer()));
	const text = doc.getText("content").toString();
	doc.free();
	return text;
}
function write(entry: TestClient, text: string): void {
	entry.doc.getText("content").push(text);
	entry.doc.commit();
	entry.socket.send(
		FromPeer.fromPeerUpdate({
			updates: [entry.doc.export({ mode: "update" })],
			id: crypto.randomUUID(),
		}).encode(),
	);
}

test("same UUID has distinct grants, snapshots, broadcasts, peers and effects", async () => {
	const id = crypto.randomUUID();
	expect(await initialize("document", id, "document")).toBe(200);
	expect(await initialize("surface", id, "surface")).toBe(200);
	expect((await connect("document", id, token("surface", id))).status).toBe(
		401,
	);
	expect((await connect("surface", id, token("document", id))).status).toBe(
		401,
	);
	for (const [kind, other] of [
		["document", "surface"],
		["surface", "document"],
	] as const) {
		expect(
			(
				await mf.dispatchFetch(url(kind, id, "snapshot"), {
					method: "POST",
					headers: { Authorization: `Bearer ${token(other, id)}` },
				})
			).status,
		).toBe(401);
	}
	expect(
		(await connect("document", `surface:${id}`, token("surface", id))).status,
	).toBe(400);
	expect(
		(await connect("surface", "invalid-id", token("surface", id))).status,
	).toBe(400);
	const document = await client("document", id);
	const surface = await client("surface", id);
	const observer = await client("surface", id);
	expect(document.doc.getText("content").toString()).toBe("document");
	expect(surface.doc.getText("content").toString()).toBe("surface");
	const peer = 12345n;
	for (const entry of [document, surface])
		entry.socket.send(FromPeer.fromPeerRegisterId({ peerid: peer }).encode());
	write(surface, " edited");
	const ack = FromRemote.decode(
		new Uint8Array((await surface.socket.waitForNextMessage()) as ArrayBuffer),
	);
	expect(ack.isRemoteUpdateAck()).toBe(true);
	const broadcast = FromRemote.decode(
		new Uint8Array((await observer.socket.waitForNextMessage()) as ArrayBuffer),
	);
	expect(broadcast.isRemoteUpdate()).toBe(true);
	expect(await content("document", id)).toBe("document");
	expect(await content("surface", id)).toBe("surface edited");
	expect(await content("surface", id.toUpperCase())).toBe("surface edited");
	const db = await mf.getD1Database("USER_PEER_MAPPING");
	const peers = await db
		.prepare("SELECT document_id, user_id FROM peer_user_map WHERE peer_id = ?")
		.bind(peer.toString())
		.all();
	expect(peers.results).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ document_id: id, user_id: "document-user" }),
			expect.objectContaining({
				document_id: `surface:${id}`,
				user_id: "surface-user",
			}),
		]),
	);
	for (const entry of [document, surface, observer])
		entry.socket.getWebSocket().close();
	await sleep(5500);
	expect(effects.some((path) => path.includes(id))).toBe(true);
	expect(effects.every((path) => !path.includes("surface:"))).toBe(true);
}, 20_000);

test("initialization races cannot overwrite a winner or revive a tombstone", async () => {
	const id = crypto.randomUUID();
	const initialized = await Promise.all([
		initialize("surface", id, "first"),
		initialize("surface", id, "second"),
	]);
	expect([...initialized].sort()).toEqual([200, 409]);
	expect(await content("surface", id)).toBe(
		initialized[0] === 200 ? "first" : "second",
	);
	const retiring = crypto.randomUUID();
	const [initialization, revocation] = await Promise.all([
		initialize("surface", retiring, "seed"),
		mf.dispatchFetch(url("surface", retiring, "revoke"), {
			method: "POST",
			headers: { "x-internal-auth-key": "local" },
		}),
	]);
	expect([200, 403]).toContain(initialization);
	expect(revocation.status).toBe(200);
	expect((await connect("surface", retiring)).status).toBe(403);
	expect(await initialize("surface", retiring, "revive")).toBe(403);
});

test("Comment cannot write surfaces but retains document websocket behavior", async () => {
	const id = crypto.randomUUID();
	for (const kind of ["document", "surface"] as const)
		expect(await initialize(kind, id, "")).toBe(200);
	const surface = await client(
		"surface",
		id,
		getTokenForSurface(id, "comment"),
	);
	write(surface, "denied");
	const document = await client(
		"document",
		id,
		getTokenForDocument(id, "commenter", "comment"),
	);
	write(document, "allowed");
	await document.socket.waitForNextMessage();
	expect(await content("surface", id)).toBe("");
	expect(await content("document", id)).toBe("allowed");
});

test("pending, revoked and expired sessions fail closed; unsupported endpoints stay unavailable", async () => {
	const id = crypto.randomUUID();
	expect((await connect("surface", id)).status).toBe(409);
	for (const operation of [
		"raw",
		"state",
		"update",
		"copy",
		"debug_dump_operations",
		"debug_do_kv_list/",
	]) {
		const response = await mf.dispatchFetch(url("surface", id, operation), {
			method: "POST",
			headers: { "x-internal-auth-key": "local" },
		});
		expect(response.status).toBe(404);
	}
	expect(
		(
			await mf.dispatchFetch(url("surface", id, "initialize"), {
				method: "POST",
				headers: { Authorization: `Bearer ${getTokenForSurface(id, "owner")}` },
			})
		).status,
	).toBe(401);
	expect(await initialize("surface", id, "ready")).toBe(200);
	expect(
		(
			await connect(
				"surface",
				id,
				getTokenForSurface(id, "edit", Math.floor(Date.now() / 1000) - 1),
			)
		).status,
	).toBe(401);
	const active = await client("surface", id);
	expect(
		(
			await mf.dispatchFetch(url("surface", id, "revoke"), {
				method: "POST",
				headers: { Authorization: `Bearer ${token("surface", id)}` },
			})
		).status,
	).toBe(401);
	expect(
		(
			await mf.dispatchFetch(url("surface", id, "revoke"), {
				method: "POST",
				headers: { "x-internal-auth-key": "local" },
			})
		).status,
	).toBe(200);
	write(active, "denied");
	active.socket.send(FromPeer.fromPeerRequestSnapshot({}).encode());
	await expect(active.socket.waitForNextMessage(100)).rejects.toThrow(
		"Timed out",
	);
	expect((await connect("surface", id)).status).toBe(403);
	expect(await initialize("surface", id, "revive")).toBe(403);
	// This workerd version buffers close delivery until teardown, even for a
	// minimal JS Durable Object. Check the actual server close code then restart.
	await mf.dispose();
	expect(await active.closed).toBe(1008);
	mf = await setupMiniflare({ persistPath, migrate: false, fetchMock });
	expect((await connect("surface", id)).status).toBe(403);
});

test("surface expiry stops idle sockets and survives persisted state reload", async () => {
	const id = crypto.randomUUID();
	expect(await initialize("surface", id, "persisted")).toBe(200);
	const active = await client(
		"surface",
		id,
		getTokenForSurface(id, "edit", Math.floor(Date.now() / 1000) + 2),
	);
	await sleep(5500);
	write(active, "denied");
	active.socket.send(FromPeer.fromPeerRequestSnapshot({}).encode());
	await expect(active.socket.waitForNextMessage(100)).rejects.toThrow(
		"Timed out",
	);
	expect(await content("surface", id)).toBe("persisted");
	const writer = await client("surface", id);
	write(writer, " live");
	await writer.socket.waitForNextMessage();
	expect(await content("surface", id)).toBe("persisted live");
	await expect(active.socket.waitForNextMessage(100)).rejects.toThrow(
		"Timed out",
	);
	expect(effects.some((path) => path.includes(id))).toBe(false);
	const revoked = crypto.randomUUID();
	await mf.dispatchFetch(url("surface", revoked, "revoke"), {
		method: "POST",
		headers: { "x-internal-auth-key": "local" },
	});
	await mf.dispose();
	expect(await active.closed).toBe(1008);
	mf = await setupMiniflare({ persistPath, migrate: false, fetchMock });
	expect((await connect("surface", revoked)).status).toBe(403);
	expect(await content("surface", id)).toBe("persisted live");
	expect(effects.some((path) => path.includes(id))).toBe(false);
}, 30_000);

test("same-UUID operation logs replay independently after eviction before the snapshot alarm", async () => {
	const id = crypto.randomUUID();
	for (const kind of ["surface", "document"] as const) {
		expect(await initialize(kind, id, kind)).toBe(200);
		const writer = await client(kind, id);
		write(writer, " persisted op");
		const ack = FromRemote.decode(
			new Uint8Array((await writer.socket.waitForNextMessage()) as ArrayBuffer),
		);
		expect(ack.isRemoteUpdateAck()).toBe(true);
	}
	await mf.dispose();
	mf = await setupMiniflare({ persistPath, migrate: false, fetchMock });
	expect(await content("surface", id)).toBe("surface persisted op");
	expect(await content("document", id)).toBe("document persisted op");
});
