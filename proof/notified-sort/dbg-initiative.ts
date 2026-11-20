// Caller-level check for initiative rows on touch Signal/Noise: main with the
// notified sort on (REST), main with it off (GraphQL, the shipped default for
// users without the flag), and the branch (GraphQL).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, readHomeDom, startApp, stopApp } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/smoke');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, { seed: 902, lanes: 1, sizes: [], outDir: out, repo: process.env.PROOF_REPO ?? '', instance: 'gqlns', log: console.log, reuse: true });
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', 30110, env, join(here, 'probe.ts'), out),
  startApp('old-flag-off', process.env.PROOF_OLD_WORKTREE ?? '', 30112, { ...env, notifiedSort: false }, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', 30111, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  const viewer = seeded.users.get('v0')!;
  const lanes = [];
  for (const app of apps) lanes.push(await openLane(browser, app, viewer, { touch: true }));
  const summary: Record<string, unknown> = {};
  for (const tab of ['Signal', 'Noise']) {
    for (const lane of lanes) {
      await lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 });
      await lane.page.getByRole('button', { name: new RegExp(`^${tab}`, 'i') }).first().click();
      await lane.page.waitForTimeout(4000);
      const rows = await readHomeDom(lane);
      const kinds: Record<string, number> = {};
      for (const row of rows) {
        const kind = row.kind === 'header' ? 'header' : (row.id.split('|')[2] ?? '?');
        kinds[kind] = (kinds[kind] ?? 0) + 1;
      }
      summary[`${tab} ${lane.side}`] = { rows: rows.length, kinds, initiatives: rows.filter((r) => r.kind === 'entity' && r.id.includes('initiative')).map((r) => r.text) };
      await lane.page.screenshot({ path: join(out, `init-${tab}-${lane.side}.png`) });
    }
  }
  writeFileSync(join(out, 'initiative-callers.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
