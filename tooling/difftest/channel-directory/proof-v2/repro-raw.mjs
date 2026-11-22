// Read-after-write matrix: v1 of a group writes each op in the app, once on
// each of its pages (main M, branch with the cache C, branch without it N),
// and that page's rows for the channels the write touched (its target, or the
// channel it created) are compared with the primary's REST list until they
// agree or the bound passes. Only those rows count: the three pages share one
// viewer, so a write on one page changes rows the others show, and how fast
// those arrive is the live check, not this one. Prints one line per op and page: how long the
// writing page took to show its own write, or what it still lacked.
// Prints ids, field names and timings only, never a session or an address.
// Usage: node repro-raw.mjs [group-number] [op,op,...] [seed]
import { launch, viewerPage, load, snapshot } from './pw.mjs';
import { restTruth } from './rest.mjs';
import { compareRows, truthRows } from './compare.mjs';
import { OPS, rng, hashSeed } from './ops.mjs';
import { loadGroup, readState } from './group-state.mjs';

const number = Number(process.argv[2] ?? 4);
const names = (process.argv[3] ?? 'create,add,remove,rename,autoJoin,convert,botAdd,botRemove,message,dm,groupDm,delete').split(',');
const seed = Number(process.argv[4] ?? 20261121);
const BOUND = Number(process.env.RAW_MS ?? 10_000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const group = loadGroup('q', number);
group.deleted = new Set();
const [actor] = group.viewers;
const [session] = group.sessions;
const browser = await launch();
const pages = {};
for (const [mode, tree] of [['M', 'main'], ['C', 'branch'], ['N', 'branch']]) {
  pages[mode] = await viewerPage(browser, session, { tree, mode });
  await load(pages[mode]);
}
const r = rng(hashSeed(seed, 'raw', group.label));
const results = [];
for (const name of names) {
  for (const mode of ['M', 'C', 'N']) {
    const state = await readState(group);
    const a = OPS[name].choose(r, state, actor);
    if (!a) {
      results.push({ op: name, mode, skipped: 'no target' });
      continue;
    }
    const inAppArgs = { ...a, team: state.team, oldName: state.channels.get(a.id)?.name ?? '' };
    const res = await pages[mode].page.evaluate(([kind, args]) => window.__proof.write(kind, args), [name, inAppArgs]);
    const resolvedAt = Date.now();
    if (res?.created) group.known.add(res.created);
    if (typeof res?.status !== 'number' || res.status >= 300) {
      results.push({ op: name, mode, refused: res?.status ?? res?.error ?? 'no status' });
      continue;
    }
    let summary;
    const targets = new Set([a.id, res.created].filter(Boolean));
    const only = (list) => list.filter((row) => targets.has(row.id));
    let truth = await restTruth(session);
    let lastTruth = Date.now();
    for (;;) {
      const rows = (await snapshot(pages[mode], { rows: true, lists: false })).rows ?? [];
      summary = compareRows(only(truthRows(truth)), only(rows));
      if (summary.equal || Date.now() - resolvedAt > BOUND) break;
      await sleep(100);
      if (Date.now() - lastTruth > 500) {
        truth = await restTruth(session);
        lastTruth = Date.now();
      }
    }
    results.push(
      summary.equal
        ? { op: name, mode, ms: Date.now() - resolvedAt }
        : { op: name, mode, timeout: BOUND, missing: summary.missing.length, extra: summary.extra.length, fields: Object.keys(summary.fields) }
    );
    console.log(JSON.stringify(results.at(-1)));
  }
}
await browser.close();
const byOp = {};
for (const row of results) (byOp[row.op] ??= {})[row.mode] = row.ms !== undefined ? `${row.ms} ms` : row.timeout ? `not within ${row.timeout} ms: ${[row.missing ? `${row.missing} missing` : '', row.extra ? `${row.extra} extra` : '', ...(row.fields ?? [])].filter(Boolean).join(', ')}` : row.skipped ?? `refused ${row.refused}`;
console.log(JSON.stringify({ group: group.label, seed, boundMs: BOUND, readAfterWrite: byOp }, null, 1));
process.exit(0);
