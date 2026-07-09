#!/usr/bin/env bun
/**
 * Fetch a document's full Loro snapshot (oplog + state) and save it to a file.
 * Pass the WS connect URL — same format used by the edit script.
 *
 *   bun run scripts/get-loro.ts "wss://sync-service-prod2.../document/<id>/connect?token=<jwt>" [output.loro]
 */
import { writeFileSync } from "fs";

const wsUrl = process.argv[2];
const outputArg = process.argv[3];

if (!wsUrl) {
	console.error(
		"Usage: bun run scripts/get-loro.ts <ws-url> [output-file]\n" +
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
const outPath = outputArg ?? `${documentId}.loro`;

const res = await fetch(`${syncBase}/document/${documentId}/snapshot`, {
	headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
	console.error(`snapshot fetch failed: ${res.status} ${res.statusText}`);
	process.exit(1);
}

const bytes = new Uint8Array(await res.arrayBuffer());
writeFileSync(outPath, bytes);
console.log(`wrote ${bytes.length} bytes → ${outPath}`);
