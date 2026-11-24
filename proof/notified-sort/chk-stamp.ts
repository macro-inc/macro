// Checks the loaded reads where a grouped REST row carries notifiedAt on one
// side only. Grouped Soup pages carry no notified_at (closure D2), so such a
// row's stamp comes from the tab: a delivered notification stamps the cached
// entity (bumpSoupEntityNotifiedAt) and raises a floor that every later
// mapping of the row resolves through for five minutes, at most 200 entities
// per tab (lib/queries/soup/normalized-cache/notified-floor.ts,
// stamp-floors.ts). For each such entity it prints whether the one side's
// value is the viewer's latest notification for it before the read, how long
// before the read it was, and how many other entities the viewer was notified
// about between it and the read (past 200, the floor is gone). Usage (inside
// nix develop, env.sh sourced): node chk-stamp.ts out/load-reads
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { q, sql, stackFromEnv } from './lib/stack.ts';

const dir = process.argv[2] ?? 'out/load-reads';
const stack = stackFromEnv();
const worldFile = readFileSync(join(dir, 'world', readFileSync(join(dir, 'run.log'), 'utf8').match(/nsort-s\d+\.json/)![0]), 'utf8');
const world = JSON.parse(worldFile) as { users: Record<string, { email: string }> };
const userOf = (viewer: string) => `macro|${world.users[viewer.replace(/^size:/, 'n')].email}`;

type Diff = { kind: string; entity?: string; path?: string; old?: unknown; new?: unknown; cls: string };
type Read = { id: number; dims: Record<string, string>; open?: Diff[]; window?: { since: string } };
const reads = readFileSync(join(dir, 'reads.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Read);
const tally = { reads: 0, rows: 0, latestBeforeRead: 0, oneSide: { old: 0, new: 0 }, pastCap: 0, pastRetention: 0 };
for (const read of reads) {
  const stamps = (read.open ?? []).filter((d) => d.kind === 'field' && d.path === '.notifiedAt' && (d.old === '<absent>' || d.new === '<absent>'));
  if (!stamps.length || !read.window) continue;
  tally.reads += 1;
  const user = userOf(read.dims.viewer);
  for (const d of stamps) {
    tally.rows += 1;
    const side = d.old === '<absent>' ? 'new' : 'old';
    tally.oneSide[side] += 1;
    const value = String(side === 'new' ? d.new : d.old);
    const id = d.entity!.split(':')[1];
    const [latest] = await sql<{ at: string }>(
      stack,
      `SELECT to_char(max(un.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at FROM user_notification un JOIN notification n ON n.id = un.notification_id WHERE un.user_id = ${q(user)} AND (un.event_item_id = ${q(id)} OR n.secondary_event_item_id = ${q(id)}) AND un.created_at < ${q(read.window.since)}::timestamptz`
    );
    const [after] = await sql<{ entities: string; notifications: string }>(
      stack,
      `SELECT count(DISTINCT un.event_item_id) AS entities, count(*) AS notifications FROM user_notification un WHERE un.user_id = ${q(user)} AND un.created_at > ${q(value)}::timestamptz AND un.created_at < ${q(read.window.since)}::timestamptz AND un.event_item_id <> ${q(id)}`
    );
    const isLatest = latest?.at != null && value.startsWith(latest.at);
    if (isLatest) tally.latestBeforeRead += 1;
    const ageS = (Date.parse(read.window.since) - Date.parse(value)) / 1000;
    if (Number(after.entities) > 200) tally.pastCap += 1;
    if (ageS > 300) tally.pastRetention += 1;
    console.log(`read ${read.id} ${read.dims.viewer} grouped=${read.dims.grouped} tab=${read.dims.tab} ${d.entity} stamped on ${side}: ${value} latest-before-read=${isLatest} age=${ageS.toFixed(0)}s other-entities-notified-since=${after.entities} (${after.notifications} notifications)`);
  }
}
console.log(JSON.stringify(tally));
