// Checks a loaded run's differing reads against the notifications the load
// wrote, for runs recorded before run.ts kept each read's write window.
//
// For every read with an open difference it prints the viewer (lane viewers
// are not load targets), and for every recorded field difference on
// notifiedAt whether both sides' values are times of real notifications for
// that viewer and entity, how many notifications lie between them, and who
// sent the newer one. Usage (inside nix develop, env.sh sourced):
//   node chk-load-race.ts out/load
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { q, sql, stackFromEnv } from './lib/stack.ts';

const dir = process.argv[2] ?? 'out/load';
const stack = stackFromEnv();
const worldFile = readFileSync(join(dir, 'world', readFileSync(join(dir, 'run.log'), 'utf8').match(/nsort-s\d+\.json/)![0]), 'utf8');
const world = JSON.parse(worldFile) as { users: Record<string, { email: string }> };
const userOf = (viewer: string) => `macro|${world.users[viewer.replace(/^size:/, 'n')].email}`;

type Read = { id: number; dims: Record<string, string>; open?: { kind: string; entity?: string; path?: string; old?: unknown; new?: unknown; cls: string }[] };
const reads = readFileSync(join(dir, 'reads.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Read);
const micros = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).getTime() * 1000 + Number((v.match(/\.\d{3}(\d{3})/) ?? [])[1] ?? 0) : null);

const tally = { readsOpen: 0, byViewer: {} as Record<string, number>, fieldChecked: 0, bothReal: 0, between: {} as Record<string, number>, newerSide: { old: 0, new: 0 }, newerSender: {} as Record<string, number>, otherKinds: {} as Record<string, number> };
const failures: unknown[] = [];
for (const read of reads) {
  const open = (read.open ?? []).filter((d) => !d.cls.startsWith('probe-error'));
  if (!open.length) continue;
  tally.readsOpen += 1;
  tally.byViewer[read.dims.viewer] = (tally.byViewer[read.dims.viewer] ?? 0) + 1;
  if (read.dims.viewer === 'lane') continue;
  const user = userOf(read.dims.viewer);
  for (const d of open) {
    if (!(d.kind === 'field' && d.path === '.notifiedAt' && d.entity)) {
      tally.otherKinds[d.kind] = (tally.otherKinds[d.kind] ?? 0) + 1;
      continue;
    }
    tally.fieldChecked += 1;
    const id = d.entity.slice(d.entity.indexOf(':') + 1);
    const rows = await sql<{ at: string; sender: string }>(
      stack,
      `SELECT to_char(un.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at, n.service_sender AS sender FROM user_notification un JOIN notification n ON n.id = un.notification_id WHERE un.user_id = ${q(user)} AND un.event_item_id = ${q(id)} ORDER BY un.created_at`
    );
    const times = rows.map((r) => micros(r.at)!);
    const [o, n] = [micros(d.old), micros(d.new)];
    const real = (t: number | null) => t === null || times.includes(t);
    if (!real(o) || !real(n)) {
      failures.push({ read: read.id, entity: d.entity, old: d.old, new: d.new, times: rows.map((r) => r.at).slice(-6) });
      continue;
    }
    tally.bothReal += 1;
    const lo = Math.min(o ?? 0, n ?? 0);
    const hi = Math.max(o ?? 0, n ?? 0);
    const between = times.filter((t) => t > lo && t < hi).length;
    tally.between[between] = (tally.between[between] ?? 0) + 1;
    tally.newerSide[(n ?? 0) > (o ?? 0) ? 'new' : 'old'] += 1;
    const sender = rows[times.indexOf(hi)]?.sender ?? 'none';
    tally.newerSender[sender] = (tally.newerSender[sender] ?? 0) + 1;
  }
}
console.log(JSON.stringify({ ...tally, failures: failures.length }, null, 1));
if (failures.length) console.log(JSON.stringify(failures.slice(0, 5)));
