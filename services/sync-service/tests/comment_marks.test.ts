import { createServer, type Server } from "node:http";
import jwt from "jsonwebtoken";
import { LoroDoc } from "loro-crdt";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
	FromPeer,
	FromRemote,
	InitializeFromSnapshotRequest,
} from "../bebop/generated/schema";
import { createTestWebSocket, setupMiniflare } from "./utils";

type Verdict = "comment_only" | "not_comment_only" | "fail";
type Check = {
	authKey: string | undefined;
	body: { before: unknown; after: unknown };
};

let mf: Miniflare;
let server: Server;
/** What the stand-in lexical-service answers, per document `root.title`. */
const verdicts = new Map<string, Verdict>();
const checks: Check[] = [];

beforeAll(async () => {
	server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		const body = JSON.parse(Buffer.concat(chunks).toString());
		checks.push({
			authKey: req.headers["x-internal-auth-key"] as string,
			body,
		});
		const verdict = verdicts.get(body.before.root.title);
		if (
			req.url !== "/comment-only-change" ||
			verdict === "fail" ||
			verdict === undefined
		) {
			res.writeHead(500).end();
			return;
		}
		res
			.writeHead(200, { "content-type": "application/json" })
			.end(JSON.stringify({ commentOnly: verdict === "comment_only" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing stand-in address");
	mf = await setupMiniflare({
		lexicalServiceUrl: `http://127.0.0.1:${address.port}`,
	});
}, 60_000);

afterAll(async () => {
	await mf?.dispose();
	await new Promise<void>((resolve, reject) =>
		server?.close((error) => (error ? reject(error) : resolve())),
	);
});

async function seed(verdict: Verdict) {
	const id = crypto.randomUUID();
	verdicts.set(id, verdict);
	const doc = new LoroDoc();
	doc.getMap("root").set("title", id);
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
	expect(response.status).toBe(200);
	return id;
}

async function connect(id: string, access: "comment" | "edit") {
	const token = jwt.sign(
		{
			document_id: id,
			user_id: `${access}-user`,
			access_level: access,
			exp: Math.floor(Date.now() / 1000) + 120,
		},
		"local",
	);
	const response = await mf.dispatchFetch(
		`http://localhost/document/${id}/connect?token=${token}`,
		{
			headers: { Upgrade: "websocket" },
		},
	);
	if (!response.webSocket) throw new Error("Expected a websocket");
	const socket = createTestWebSocket(response.webSocket);
	response.webSocket.accept();
	const initial = FromRemote.decode(
		new Uint8Array((await socket.waitForNextMessage()) as ArrayBuffer),
	);
	if (!initial.isRemoteInitialSync())
		throw new Error("Expected initial snapshot");
	const doc = new LoroDoc();
	doc.import(initial.value.snapshot);
	return { ...socket, doc };
}

type Client = Awaited<ReturnType<typeof connect>>;

/** Sends `write` as one update and resolves with whether the server acked it. */
async function send(
	client: Client,
	write: (doc: LoroDoc) => void,
): Promise<boolean> {
	const from = client.doc.oplogVersion();
	write(client.doc);
	client.doc.commit();
	const id = crypto.randomUUID();
	client.send(
		FromPeer.fromPeerUpdate({
			updates: [client.doc.export({ mode: "update", from })],
			id,
		}).encode(),
	);
	try {
		for (;;) {
			const message = FromRemote.decode(
				new Uint8Array((await client.waitForNextMessage(1500)) as ArrayBuffer),
			);
			if (message.isRemoteUpdateAck() && message.value.id === id) return true;
		}
	} catch {
		return false;
	}
}

async function stored(id: string) {
	const response = await mf.dispatchFetch(
		`http://localhost/document/${id}/raw`,
		{
			headers: { "x-internal-auth-key": "local" },
		},
	);
	expect(response.status).toBe(200);
	return response.json();
}

test("a commenter update that only changes comment marks is stored", async () => {
	const id = await seed("comment_only");
	const commenter = await connect(id, "comment");
	checks.length = 0;

	expect(
		await send(commenter, (doc) => doc.getMap("root").set("mark", "mark-1")),
	).toBe(true);

	expect(checks).toEqual([
		{
			authKey: "lexical-key",
			body: {
				before: { root: { title: id } },
				after: { root: { title: id, mark: "mark-1" } },
			},
		},
	]);
	expect(await stored(id)).toEqual({ root: { title: id, mark: "mark-1" } });
});

test("a commenter update that changes more than comment marks is refused", async () => {
	const id = await seed("not_comment_only");
	const commenter = await connect(id, "comment");

	expect(
		await send(commenter, (doc) => doc.getMap("root").set("body", "rewritten")),
	).toBe(false);

	expect(await stored(id)).toEqual({ root: { title: id } });
});

test("a commenter update is refused when the check fails", async () => {
	const id = await seed("fail");
	const commenter = await connect(id, "comment");

	expect(
		await send(commenter, (doc) => doc.getMap("root").set("mark", "mark-1")),
	).toBe(false);

	expect(await stored(id)).toEqual({ root: { title: id } });
});

test("a commenter update outside the document body is refused without a check", async () => {
	const id = await seed("comment_only");
	const commenter = await connect(id, "comment");
	checks.length = 0;

	expect(
		await send(commenter, (doc) => doc.getText("content").insert(0, "hidden")),
	).toBe(false);

	expect(checks).toEqual([]);
	expect(await stored(id)).toEqual({ root: { title: id } });
});

test("an editor update is stored without a check", async () => {
	const id = await seed("fail");
	const editor = await connect(id, "edit");
	checks.length = 0;

	expect(
		await send(editor, (doc) => doc.getMap("root").set("body", "rewritten")),
	).toBe(true);

	expect(checks).toEqual([]);
	expect(await stored(id)).toEqual({ root: { title: id, body: "rewritten" } });
});
