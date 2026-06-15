#!/usr/bin/env bun
// grab-snapshot.ts — copy a doc's content (and its peer->user map) from a source
// sync-service onto an EXISTING dev doc by swapping its in-memory state via the
// set_memory_state endpoint (no auth). The target doc keeps its own id +
// permissions; only its live content + legend are replaced.
//
const argv = process.argv.slice(2);
const useDev = argv.includes('--dev');
const [token, srcDocId, targetDocId] = argv.filter((a) => !a.startsWith('--'));
if (!token || !srcDocId || !targetDocId) {
  console.error(
    'usage: bun run scripts/grab-snapshot.ts [--dev] <token> <source-document-id> <target-dev-document-id>'
  );
  process.exit(1);
}

const SOURCE_URL =
  process.env.SOURCE_URL ??
  (useDev
    ? 'https://sync-service-dev3.macroverse.workers.dev'
    : 'https://sync-service-prod2.macroverse.workers.dev');
const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:8787';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const auth = { Authorization: `Bearer ${token}` };

// 1. grab the loro snapshot from the source.
const grab = await fetch(`${SOURCE_URL}/document/${srcDocId}/snapshot`, { headers: auth });
if (!grab.ok) {
  console.error(`snapshot grab failed: ${grab.status} ${grab.statusText}`);
  process.exit(1);
}
const snapshot = new Uint8Array(await grab.arrayBuffer());

// 2. grab the peer->user map (metadata) so the legend resolves on the target.
let peers: Array<{ peer_id: string; user_id: string }> = [];
const meta = await fetch(`${SOURCE_URL}/document/${srcDocId}/metadata`, { headers: auth });
if (meta.ok) {
  peers = ((await meta.json()) as { peers?: typeof peers }).peers ?? [];
} else {
  console.warn(`metadata fetch failed (${meta.status}); continuing without peer map`);
}

// keep a local copy to poke at
const outFile = `${import.meta.dir}/${srcDocId}.snapshot.bin`;
await Bun.write(outFile, snapshot);

// 3. swap onto the target dev doc's in-memory state, with the peer map (no auth).
// Dirty-simple: one JSON body with the snapshot as a byte array + the peer map.
const set = await fetch(`${TARGET_URL}/document/${targetDocId}/set_memory_state`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ snapshot: Array.from(snapshot), peers }),
});
if (!set.ok) {
  console.error(`set_memory_state failed: ${set.status} — ${await set.text()}`);
  process.exit(1);
}

console.log(`grabbed ${snapshot.length} bytes + ${peers.length} peers from ${useDev ? 'dev' : 'prod'}`);
console.log(`swapped onto dev doc ${targetDocId} (in-memory)`);
console.log(`  ${APP_URL}/app/md/${targetDocId}`);
