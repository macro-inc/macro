import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	FromPeer,
	InitializeFromSnapshotRequest,
} from "../bebop/generated/schema";
import {
	copyDocument,
	createTestUser,
	getTokenForDocument,
	setupMiniflare,
} from "./utils";

type User = Awaited<ReturnType<typeof createTestUser>>;
let mf: Miniflare;
const users: User[] = [];
const persistPath = mkdtempSync(join(tmpdir(), "macro-spreadsheet-sync-"));
beforeAll(async () => {
	mf = await setupMiniflare({ persistPath });
}, 60_000);
afterAll(async () => {
	for (const user of users) {
		if (user.getWebSocket().readyState === 1) user.getWebSocket().close();
	}
	await mf?.dispose();
	rmSync(persistPath, { recursive: true, force: true });
});

async function open(
	id: string,
	userId: string,
	permissionLevel: "owner" | "edit" | "view" = "edit",
) {
	const user = await createTestUser(mf, id, { userId, permissionLevel });
	users.push(user);
	return user;
}

async function seed() {
	const id = crypto.randomUUID();
	const response = await mf.dispatchFetch(
		`http://localhost/document/${id}/initialize`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${getTokenForDocument(id, "alice", "owner")}`,
				"Content-Type": "application/octet-stream",
			},
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

const sent = new WeakMap<User, string>();
function send(user: User) {
	user.doc.commit();
	const id = crypto.randomUUID();
	sent.set(user, id);
	user.send(
		FromPeer.fromPeerUpdate({
			updates: [user.doc.export({ mode: "update" })],
			id,
		}).encode(),
	);
}

async function receiveUntil(user: User, ready: () => boolean) {
	while (!ready()) {
		const message = await user.readNextMessage();
		if (message.isRemoteUpdate()) user.doc.import(message.value.update);
		if (message.isRemoteAwareness())
			user.awareness.apply(message.value.awareness);
	}
}

async function acknowledge(user: User) {
	for (;;) {
		const message = await user.readNextMessage();
		if (message.isRemoteUpdateAck() && message.value.id === sent.get(user))
			return;
		if (message.isRemoteUpdate()) user.doc.import(message.value.update);
	}
}

describe("native spreadsheets over the real sync worker", () => {
	it("preserves multiple sheet identities, independent cells and layouts, and sheet-aware presence across reopen and copy", async () => {
		const id = await seed();
		const alice = await open(id, "alice");
		const sheetId = crypto.randomUUID();
		alice.doc.getMap("spreadsheetSheetNames").set("sheet1", "Inputs");
		alice.doc.getMap("spreadsheetSheetNames").set(sheetId, "Summary");
		alice.doc.getMap("spreadsheetSheetOrder").set(sheetId, 1);
		alice.doc.getMap("spreadsheetSheetRevivals").set("revival-proof", "sheet1");
		alice.doc
			.getMap("spreadsheetSheetRetentions")
			.set(
				`${sheetId}!peer`,
				JSON.stringify({ name: "Summary", order: 1, revision: 1 }),
			);
		alice.doc.getMap("spreadsheetSheetNames").set("retired", "Archived");
		alice.doc.getMap("spreadsheetSheetOrder").set("retired", 2);
		alice.doc.getMap("spreadsheetDeletedSheets").set("retired", true);
		send(alice);
		await acknowledge(alice);
		const bob = await open(id, "bob");

		// Identical addresses belong to independent namespaces. Separate property
		// maps also merge a value edit and first-time formatting on the same cell.
		alice.doc.getMap("spreadsheetValues").set("A1", "21");
		alice.doc.getMap("spreadsheetValues").set(`${sheetId}!A1`, "=Inputs!A1*2");
		alice.doc.getMap("spreadsheetColumnWidths").set("0", 120);
		alice.doc.getMap("spreadsheetRowAdditions").set("legacy-append", 100);
		bob.doc.getMap("spreadsheetValues").set(`${sheetId}!B1`, "summary only");
		bob.doc.getMap("spreadsheetBold").set(`${sheetId}!A1`, true);
		bob.doc.getMap("spreadsheetColumnWidths").set(`${sheetId}!0`, 240);
		bob.doc.getMap("spreadsheetRowAdditions").set(`${sheetId}!append`, 200);
		send(alice);
		send(bob);
		await Promise.all([acknowledge(alice), acknowledge(bob)]);
		await Promise.all([
			receiveUntil(
				alice,
				() => alice.doc.getMap("spreadsheetBold").get(`${sheetId}!A1`) === true,
			),
			receiveUntil(
				bob,
				() => bob.doc.getMap("spreadsheetValues").get("A1") === "21",
			),
		]);
		expect(alice.doc.toJSON()).toEqual(bob.doc.toJSON());
		expect(bob.doc.getMap("spreadsheetColumnWidths").toJSON()).toEqual({
			"0": 120,
			[`${sheetId}!0`]: 240,
		});
		expect(bob.doc.getMap("spreadsheetRowAdditions").toJSON()).toEqual({
			"legacy-append": 100,
			[`${sheetId}!append`]: 200,
		});
		expect(bob.doc.getMap("spreadsheetValues").get(`${sheetId}!A1`)).toBe(
			"=Inputs!A1*2",
		);

		const selection = { sheetId, anchor: "A1", focus: "B2" };
		alice.awareness.set(alice.doc.peerIdStr, { selection });
		alice.send(
			FromPeer.fromPeerAwareness({
				awareness: alice.awareness.encode(alice.doc.peerIdStr),
			}).encode(),
		);
		await receiveUntil(
			bob,
			() => bob.awareness.getAllStates()[alice.doc.peerIdStr] !== undefined,
		);
		expect(bob.awareness.getAllStates()[alice.doc.peerIdStr]).toMatchObject({
			selection,
		});
		const reopened = await open(id, "reopened");
		expect(reopened.doc.toJSON()).toEqual(alice.doc.toJSON());
		expect(
			reopened.awareness.getAllStates()[alice.doc.peerIdStr],
		).toMatchObject({ selection });
		expect(reopened.doc.getMap("spreadsheetDeletedSheets").get("retired")).toBe(
			true,
		);
		expect(
			reopened.doc.getMap("spreadsheetSheetRevivals").get("revival-proof"),
		).toBe("sheet1");
		expect(
			reopened.doc.getMap("spreadsheetSheetRetentions").get(`${sheetId}!peer`),
		).toBe(JSON.stringify({ name: "Summary", order: 1, revision: 1 }));

		const copyId = crypto.randomUUID();
		expect((await copyDocument(mf, id, copyId)).status).toBe(200);
		const copied = await open(copyId, "copy-owner", "owner");
		expect(copied.doc.toJSON()).toEqual(reopened.doc.toJSON());
		copied.doc.getMap("spreadsheetValues").set(`${sheetId}!A1`, "copy only");
		send(copied);
		await acknowledge(copied);
		const original = await open(id, "original-check");
		expect(original.doc.getMap("spreadsheetValues").get(`${sheetId}!A1`)).toBe(
			"=Inputs!A1*2",
		);
	}, 30_000);

	it("converges concurrent values and independent formatting, then reopens and copies the workbook", async () => {
		const id = await seed();
		const alice = await open(id, "alice");
		const bob = await open(id, "bob");
		alice.doc.getMap("spreadsheetValues").set("B4", "4500");
		alice.doc.getMap("spreadsheetValues").set("D4", "=B4-C4");
		alice.doc.getMap("spreadsheetColumnWidths").set("3", 224);
		alice.doc.getMap("spreadsheetRowAdditions").set("alice-append", 100);
		bob.doc.getMap("spreadsheetValues").set("C4", "3200");
		bob.doc.getMap("spreadsheetBold").set("D4", true);
		bob.doc.getMap("spreadsheetRowAdditions").set("bob-append", 100);
		send(alice);
		send(bob);
		await Promise.all([
			receiveUntil(
				alice,
				() => alice.doc.getMap("spreadsheetValues").get("C4") === "3200",
			),
			receiveUntil(
				bob,
				() => bob.doc.getMap("spreadsheetValues").get("D4") === "=B4-C4",
			),
		]);
		expect(alice.doc.toJSON()).toEqual(bob.doc.toJSON());
		alice.doc.getMap("spreadsheetValues").set("A1", "alice");
		bob.doc.getMap("spreadsheetValues").set("A1", "bob");
		send(alice);
		send(bob);
		// A fresh snapshot includes both concurrent operations even when each
		// client's own acknowledgement and the other update arrive in either order.
		await acknowledge(alice);
		await acknowledge(bob);
		const reopened = await open(id, "reopened");
		const sourceState = reopened.doc.toJSON();
		expect(["alice", "bob"]).toContain(
			reopened.doc.getMap("spreadsheetValues").get("A1"),
		);
		expect(reopened.doc.getMap("spreadsheetBold").get("D4")).toBe(true);
		expect(reopened.doc.getMap("spreadsheetRowAdditions").toJSON()).toEqual({
			"alice-append": 100,
			"bob-append": 100,
		});
		const copyId = crypto.randomUUID();
		expect((await copyDocument(mf, id, copyId)).status).toBe(200);
		const copied = await open(copyId, "copy-owner", "owner");
		expect(copied.doc.toJSON()).toEqual(sourceState);
		copied.doc.getMap("spreadsheetValues").set("A1", "only the copy");
		send(copied);
		await acknowledge(copied);
		const original = await open(id, "original-check");
		expect(original.doc.toJSON()).toEqual(sourceState);
	}, 30_000);

	it("merges offline edits with remote changes when reconnecting", async () => {
		const id = await seed();
		const alice = await open(id, "alice");
		const bob = await open(id, "bob");
		alice.getWebSocket().close();
		alice.doc.getMap("spreadsheetValues").set("A201", "=B4*2");
		alice.doc.getMap("spreadsheetRowAdditions").set("offline-append", 100);
		alice.doc.commit();
		bob.doc.getMap("spreadsheetValues").set("B4", "42");
		send(bob);
		await acknowledge(bob);
		const connection = await open(id, "alice");
		// Like the frontend, retain the offline document and merge the server's
		// snapshot into it. A new shallow document has discarded the causal
		// history required to import edits made against the older snapshot.
		alice.doc.import(connection.doc.export({ mode: "snapshot" }));
		const restored = { ...connection, doc: alice.doc };
		send(restored);
		await acknowledge(restored);
		await receiveUntil(
			bob,
			() => bob.doc.getMap("spreadsheetValues").get("A201") === "=B4*2",
		);
		expect(restored.doc.toJSON()).toEqual(bob.doc.toJSON());
		const reopened = await open(id, "saved-check");
		expect(reopened.doc.toJSON()).toEqual(bob.doc.toJSON());
	}, 20_000);

	it("rejects writes after reconnecting with downgraded permission, and accepts them after upgrading", async () => {
		const id = await seed();
		const owner = await open(id, "owner", "owner");
		const editor = await open(id, "bob");
		editor.doc.getMap("spreadsheetValues").set("A1", "allowed");
		send(editor);
		await acknowledge(editor);
		editor.getWebSocket().close();
		const viewer = await open(id, "bob", "view");
		viewer.doc.getMap("spreadsheetValues").set("A1", "denied");
		send(viewer);
		// A subsequent owner round trip is a barrier for processing the denied edit.
		owner.doc.getMap("spreadsheetValues").set("B1", "barrier");
		send(owner);
		await acknowledge(owner);
		const check = await open(id, "permission-check");
		expect(check.doc.getMap("spreadsheetValues").get("A1")).toBe("allowed");
		viewer.getWebSocket().close();
		const upgraded = await open(id, "bob", "edit");
		upgraded.doc.getMap("spreadsheetValues").set("A1", "allowed again");
		send(upgraded);
		await acknowledge(upgraded);
		const saved = await open(id, "final-check");
		expect(saved.doc.getMap("spreadsheetValues").get("A1")).toBe(
			"allowed again",
		);
	}, 20_000);

	it("restores acknowledged cells and layout after the worker process restarts", async () => {
		const id = await seed();
		const user = await open(id, "alice");
		user.doc.getMap("spreadsheetValues").set("A250", "=SUM(B4:B7)");
		user.doc.getMap("spreadsheetColumnWidths").set("0", 256);
		user.doc.getMap("spreadsheetRowAdditions").set("append", 100);
		user.doc.getMap("spreadsheetSheetNames").set("persisted-sheet", "Forecast");
		user.doc.getMap("spreadsheetSheetOrder").set("persisted-sheet", 1);
		user.doc.getMap("spreadsheetDeletedSheets").set("persisted-sheet", true);
		user.doc
			.getMap("spreadsheetSheetRevivals")
			.set("persisted-revival", "persisted-sheet");
		user.doc
			.getMap("spreadsheetSheetRetentions")
			.set(
				"persisted-sheet!peer",
				JSON.stringify({ name: "Forecast", order: 1, revision: 1 }),
			);
		user.doc
			.getMap("spreadsheetValues")
			.set("persisted-sheet!A250", "=Sheet1!A250*2");
		user.doc.getMap("spreadsheetColumnWidths").set("persisted-sheet!0", 320);
		user.doc
			.getMap("spreadsheetRowAdditions")
			.set("persisted-sheet!append", 200);
		send(user);
		await acknowledge(user);
		const saved = user.doc.toJSON();
		for (const connected of users.splice(0)) {
			if (connected.getWebSocket().readyState === 1)
				connected.getWebSocket().close();
		}
		await mf.dispose();
		mf = await setupMiniflare({ persistPath, migrate: false });
		const restored = await open(id, "alice");
		expect(restored.doc.toJSON()).toEqual(saved);
	}, 30_000);
});
