import fs from 'node:fs';
import { launch, viewerPage, load } from './pw.mjs';
const session = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await launch();
const viewer = await viewerPage(browser, session, { tree: 'branch', mode: 'C' });
const logs = [];
viewer.page.on('console', (m) => { if (['warning', 'error'].includes(m.type()) || /cache|worker/i.test(m.text())) logs.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
viewer.context.on('weberror', (e) => logs.push(`weberror: ${String(e.error()).slice(0, 300)}`));
const loaded = await load(viewer);
const at = [];
for (let i = 0; i < 6; i++) { at.push(await viewer.page.evaluate(() => ({ mode: window.__proof.mode(), sw: typeof SharedWorker, opfs: typeof navigator.storage?.getDirectory, coi: self.crossOriginIsolated }))); await new Promise((r) => setTimeout(r, 2000)); }
console.log(JSON.stringify({ loaded, at, logs: logs.slice(0, 40), errors: viewer.errors }, null, 1));
await browser.close();
