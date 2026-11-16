import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
	FromRemote,
	InitializeFromSnapshotRequest,
} from "../bebop/generated/schema";
import {
	connectToDocumentForTesting,
	getTokenForDocument,
	setupMiniflare,
} from "./utils";

it.skipIf(!process.env.SYNC_TEST_UNINITIALIZED_ROOMS)(
	"a connected unseeded room remains missing until a canonical Canvas snapshot is durably initialized",
	async () => {
		const mf = await setupMiniflare();
		const id = crypto.randomUUID();
		const peer = await connectToDocumentForTesting(mf, id, {
			userId: "alice",
			permissionLevel: "owner",
		});
		try {
			const missing = await mf.dispatchFetch(
				`http://localhost/document/${id}/exists`,
				{ method: "HEAD" },
			);
			expect(missing.status).toBe(404);
			const initial = peer.waitForNextMessage();
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
							readFileSync("../../static_assets/canvas-golden.1.bin"),
						),
					}),
				},
			);
			expect(response.status).toBe(200);
			const bytes = await initial;
			if (typeof bytes === "string")
				throw new Error("Expected binary initial sync");
			const message = FromRemote.decode(new Uint8Array(bytes));
			expect(message.isRemoteInitialSync()).toBe(true);
			const exists = await mf.dispatchFetch(
				`http://localhost/document/${id}/exists`,
				{ method: "HEAD" },
			);
			expect(exists.status).toBe(200);
			const repeated = await mf.dispatchFetch(
				`http://localhost/document/${id}/initialize`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${getTokenForDocument(id, "alice", "owner")}`,
					},
					body: new Uint8Array(),
				},
			);
			expect(repeated.status).toBe(409);
		} finally {
			peer.getWebSocket().close();
			await mf.dispose();
		}
	},
	60_000,
);
