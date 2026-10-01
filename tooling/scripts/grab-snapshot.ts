#!/usr/bin/env bun
// Copy a native Automerge snapshot into a local worker built with test endpoints.
const argv = process.argv.slice(2);
const [token, srcDocId, targetDocId, targetUrlArg] = argv;
const SOURCE_URL = process.env.SOURCE_URL;
if (!SOURCE_URL || !token || !srcDocId || !targetDocId) {
  console.error(
    'usage: SOURCE_URL=<automerge-worker-url> bun run tooling/scripts/grab-snapshot.ts <token> <source-document-id> <target-local-document-id> [target-url]'
  );
  process.exit(1);
}

const TARGET_URL = targetUrlArg ?? process.env.TARGET_URL ?? 'http://localhost:8787';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const grab = await fetch(`${SOURCE_URL}/document/${srcDocId}/snapshot`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!grab.ok) {
  console.error(`snapshot grab failed: ${grab.status} ${grab.statusText}`);
  process.exit(1);
}
const snapshot = new Uint8Array(await grab.arrayBuffer());

let peers: Array<{ peer_id: string; user_id: string }> = [];
const meta = await fetch(`${SOURCE_URL}/document/${srcDocId}/metadata`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (meta.ok) {
  peers = ((await meta.json()) as { peers?: typeof peers }).peers ?? [];
} else {
  console.warn(`metadata fetch failed (${meta.status}); continuing without peer map`);
}

const set = await fetch(`${TARGET_URL}/document/${targetDocId}/set_memory_state`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ snapshot: Array.from(snapshot), peers }),
});
if (!set.ok) {
  console.error(`set_memory_state failed: ${set.status} — ${await set.text()}`);
  process.exit(1);
}

console.log(`grabbed ${snapshot.length} bytes + ${peers.length} peers from ${SOURCE_URL}`);
console.log(`swapped onto dev doc ${targetDocId} (in-memory)`);
console.log(`  ${APP_URL}/app/md/${targetDocId}`);
