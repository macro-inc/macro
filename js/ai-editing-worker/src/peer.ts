import { LoroDoc } from "loro-crdt";
import {
	FromPeer,
	FromRemote,
} from "../../app/packages/service-clients/service-sync/generated/schema";
import { LoroPeerPool } from "./ai-editing/loro/loro-peer-pool";
import { MARKDOWN_LORO_SCHEMA, type MarkdownLoroSchemaType } from "../../lexical-core/markdown-loro-schema";
import { Mirror } from "@loro-mirror/packages/core/src";

/** How many distinct loro peers the AI's edits are spread across. */
const PEER_POOL_SIZE = 8;

export type Peer = {
	doc: LoroDoc;
	mirror: Mirror<MarkdownLoroSchemaType>;
	/** Bounded set of loro peer ids the applied edits are attributed to. */
	peerPool: LoroPeerPool;
	/** Broadcast an ephemeral awareness blob (AI cursors) to the room. */
	sendAwareness: (bytes: Uint8Array) => void;
	disconnect: () => void;
};

export function connectPeer(
	wsUrl: string,
	signal?: AbortSignal,
): Promise<Peer> {
	return new Promise((resolve, reject) => {
		const doc = new LoroDoc();
		const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });
		let resolved = false;

		const ws = new WebSocket(wsUrl);
		ws.binaryType = "arraybuffer";

		signal?.addEventListener("abort", () => {
			ws.close(1000, "aborted");
			if (!resolved) reject(new DOMException("Aborted", "AbortError"));
		});

		ws.onmessage = (ev: MessageEvent) => {
			// Sync server sends text 'ping'; reply 'pong' to keep the connection alive.
			if (typeof ev.data === "string") {
				if (ev.data === "ping") ws.send("pong");
				return;
			}

			let msg: FromRemote;
			try {
				msg = FromRemote.decode(new Uint8Array(ev.data as ArrayBuffer));
			} catch {
				return;
			}

			if (msg.isRemoteInitialSync()) {
				const { snapshot } = msg.value as { snapshot: Uint8Array };
				doc.import(snapshot);

				// Spread the AI's edits across a bounded pool of distinct loro peer ids
				// (semaphore-style), so the doc's history shows several authors. Derive
				// the ids from the doc's own peer id so they never collide with it, and
				// register every one with the server up front — the server keeps a SET
				// of peer ids per connection and maps each to this user, so commits
				// attributed to any pooled id are accepted and attributed correctly.
				const peerPool = LoroPeerPool.fromSeed(
					doc.peerId as unknown as bigint,
					PEER_POOL_SIZE,
				);
				for (const peerid of [
					doc.peerId as unknown as bigint,
					...peerPool.peerIds(),
				]) {
					try {
						ws.send(FromPeer.encode(FromPeer.fromPeerRegisterId({ peerid })));
					} catch {
						/* best-effort attribution */
					}
				}

				// Push local commits to the server as they happen.
				doc.subscribeLocalUpdates((update) => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(
							FromPeer.encode(
								FromPeer.fromPeerUpdate({
									updates: [update],
									id: crypto.randomUUID(),
								}),
							),
						);
					}
				});

				const sendAwareness = (bytes: Uint8Array) => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(
							FromPeer.encode(FromPeer.fromPeerAwareness({ awareness: bytes })),
						);
					}
				};

				resolved = true;
				resolve({
					doc,
					mirror,
					peerPool,
					sendAwareness,
					disconnect: () => ws.close(1000, "done"),
				});
			} else if (msg.isRemoteUpdate()) {
				try {
					doc.import((msg.value as { update: Uint8Array }).update);
				} catch {
					/* drop updates with missing causal history */
				}
			}
		};

		ws.onerror = () => {
			if (!resolved) reject(new Error("WebSocket connection failed"));
		};

		ws.onclose = (ev: CloseEvent) => {
			if (!resolved)
				reject(new Error(`WebSocket closed before initial sync: ${ev.code}`));
		};
	});
}
