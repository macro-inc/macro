import fs from 'node:fs';
import { launch, viewerPage, load, snapshot } from './pw.mjs';
import { restTruth } from './rest.mjs';
const session = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await launch();
const out = { truth: await restTruth(session) };
for (const [mode, tree] of [['M', 'main'], ['C', 'branch'], ['N', 'branch']]) {
  const viewer = await viewerPage(browser, session, { tree, mode });
  await load(viewer);
  out[mode] = await snapshot(viewer, { rows: true });
  await viewer.context.close();
}
await browser.close();
fs.writeFileSync(process.argv[3], JSON.stringify(out));
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
const t = byId(out.truth.rows), m = byId(out.M.rows), c = byId(out.C.rows);
const id = out.truth.rows.find((r) => r.channel_type === 'private' && r.name)?.id ?? out.truth.rows[0].id;
console.log(JSON.stringify({ truth: t[id], M: m[id], C: c[id], activityTruth: out.truth.activity.slice?.(0, 2) ?? out.truth.activity, activityM: Object.entries(out.M.activity ?? {}).slice(0, 2), activityC: Object.entries(out.C.activity ?? {}).slice(0, 2) }, null, 1).slice(0, 5000));
