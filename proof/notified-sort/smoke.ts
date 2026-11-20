// A first look: seed a small world, bring up both apps and read Home's
// Signal and Noise through each side's facade.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, startApp, stopApp } from './lib/browser.ts';
import { classify, tally } from './lib/classify.ts';
import { compareSnapshots } from './lib/compare.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = process.env.PROOF_OUT ?? join(here, 'out/smoke');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const env = {
  backendProxy: stack.proxyUrl,
  routes: process.env.PROOF_ROUTES ?? '',
  caPem: process.env.PROOF_CA_PEM ?? '',
  hostname: process.env.PROOF_HOSTNAME ?? 'localhost',
};
const seed = Number(process.env.PROOF_SEED ?? 900);
const seeded = await seedWorld(stack, {
  seed,
  lanes: 1,
  sizes: [],
  outDir: out,
  repo: process.env.PROOF_REPO ?? '',
  instance: process.env.PROOF_INSTANCE ?? 'gqlns',
  log: console.log,
});
const [oldApp, newApp] = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', 30110, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', 30111, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  const viewer = seeded.users.get('v0')!;
  const [oldLane, newLane] = await Promise.all([
    openLane(browser, oldApp, viewer),
    openLane(browser, newApp, viewer),
  ]);
  for (const tab of ['signal', 'noise'] as const) {
    const spec = { home: { tab, facets: {}, foreignEntities: true } };
    const [a, b] = await Promise.all([
      probeRead(oldLane, viewer.macroUserId, spec),
      probeRead(newLane, viewer.macroUserId, spec),
    ]);
    console.log(tab, 'old', a.transport, a.entities.length, a.error, a.ms, 'new', b.transport, b.entities.length, b.error, b.ms);
    const diffs = compareSnapshots(a, b).map(classify);
    const t = tally(diffs.filter((d) => !d.cls.startsWith('same-instant')));
    for (const [cls, { n, example }] of t)
      console.log(`${n}\t${cls}\told=${JSON.stringify(example.old)?.slice(0, 160)}\tnew=${JSON.stringify(example.new)?.slice(0, 300)}`);
    console.log('same-instant', diffs.filter((d) => d.cls.startsWith('same-instant')).length);
  }
} finally {
  await browser.close();
  stopApp(oldApp);
  stopApp(newApp);
}
