#!/usr/bin/env bun
/**
 * Fetch a document's Loro snapshot from the sync service and decode it to
 * Lexical JSON.  Pass the WS connect URL directly (copy from browser devtools).
 *
 *   bun run scripts/get-lexical.ts "wss://sync-service-prod2.macroverse.workers.dev/document/<id>/connect?token=<jwt>"
 */
import { LoroManager } from "../../app/packages/core/collab/manager";
import { MARKDOWN_LORO_SCHEMA } from "../../lexical-core/markdown-loro-schema";

const wsUrl = process.argv[2];
if (!wsUrl) {
	console.error(
		"Usage: bun run scripts/get-lexical.ts <ws-url>\n" +
		'  e.g. "wss://sync-service-prod2.macroverse.workers.dev/document/<id>/connect?token=<jwt>"',
	);
	process.exit(1);
}

const parsed = new URL(wsUrl);
const token = parsed.searchParams.get("token");
const docMatch = parsed.pathname.match(/\/document\/([^/]+)\/connect/);
if (!token || !docMatch) {
	console.error("could not parse token or document id from url");
	process.exit(1);
}
const documentId = docMatch[1]!;
const syncBase = `https://${parsed.host}`;

const res = await fetch(`${syncBase}/document/${documentId}/snapshot`, {
	headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
	console.error(`snapshot fetch failed: ${res.status} ${res.statusText}`);
	process.exit(1);
}

const snapshot = new Uint8Array(await res.arrayBuffer());
process.stderr.write(`fetched ${snapshot.length} bytes\n`);

const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
const result = await manager.initializeFromSnapshot(snapshot);
if (result.isErr()) {
	console.error("failed to initialize from snapshot:", result.error);
	process.exit(1);
}

const lexicalState = manager.mirror!.getState();
process.stdout.write(JSON.stringify(lexicalState, null, 2));
