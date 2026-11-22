import fs from 'node:fs';
import { launch, viewerPage, load, snapshot } from './pw.mjs';
const session = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await launch();
const out = {};
for (const [mode, tree] of [['M', 'main'], ['C', 'branch'], ['N', 'branch']]) {
  const viewer = await viewerPage(browser, session, { tree, mode });
  const loaded = await load(viewer);
  const first = await snapshot(viewer, { rows: true, lists: false });
  const ids = (first.rows ?? []).slice(0, 5).map((row) => row.id);
  const snap = await snapshot(viewer, { ids, peers: [], open: true, labels: [{ channelIds: [] }], facts: true, pickerSearch: ['ops'] });
  out[mode] = { loaded, rows: snap.rows?.length, tookMs: snap.tookMs, perIdKeys: Object.keys(Object.values(snap.perId)[0] ?? {}), sample: Object.values(snap.perId)[0], lists: Object.fromEntries(Object.entries(snap.lists ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])), open: snap.open && { picker: snap.open.picker.map((p) => p.ids.length), mute: snap.open.mute.map((m) => m.ids.length), dialog: snap.open.dialog, groups: Object.fromEntries(Object.entries(snap.open.groupIds).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])) }, facts: Array.isArray(snap.facts) ? snap.facts.length : snap.facts, errors: viewer.errors.slice(0, 5) };
  await viewer.context.close();
}
await browser.close();
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
