// Repro for closure P1: one tab reads the same notified list twice, three
// pages each time, on main's REST reader, the branch's reader, and main's
// GraphQL reader (update-time sort). Prints the rows each read returned and
// whether the second read's first rows are the first read's.
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { entityKey } from './lib/compare.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const seed = Number(process.env.PROOF_SEED ?? 1701);
const out = join(here, 'out/dbg-retained');
const stack = stackFromEnv();
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed,
  lanes: Number(process.env.DBG_LANES ?? 24),
  sizes: (process.env.DBG_SIZES ?? '0,1,100,101,2000').split(',').map(Number),
  outDir: join(here, process.env.DBG_WORLD ?? 'out/quiet/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: console.log,
  reuse: true,
});
const viewer = seeded.world.viewers.find((v) => v.role === 'size' && v.size === Number(process.env.DBG_SIZE ?? 2000));
if (!viewer) throw new Error('no such viewer');
const user = seeded.users.get(viewer.key)!;
const spec: ReadSpec = {
  source: { kind: 'preset', tab: 'signal' },
  params: { limit: 5, sort_method: 'notified_at', sort_direction: 'desc' },
  showForeign: true,
  fresh: false,
  maxPages: 3,
};
const [oldApp, newApp] = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', 30110, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', 30111, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  const sides = [
    ['main (REST, notified)', oldApp, spec],
    ['branch (GraphQL, notified)', newApp, spec],
    ['main (GraphQL, update time)', oldApp, { ...spec, params: { ...spec.params, sort_method: 'updated_at' } }],
  ] as const;
  for (const [name, app, s] of sides) {
    const lane = await openLane(browser, app, user);
    const first = await probeRead(lane, user.macroUserId, s);
    const second = await probeRead(lane, user.macroUserId, s);
    const a = first.entities.map(entityKey);
    const b = second.entities.map(entityKey);
    console.log(
      JSON.stringify({
        reader: name,
        transport: second.transport,
        first: { rows: a.length, pages: first.pages },
        second: { rows: b.length, pages: second.pages },
        secondStartsWithFirst: a.every((key, i) => b[i] === key),
      })
    );
    await lane.context.close();
  }
} finally {
  await browser.close();
  stopApp(oldApp);
  stopApp(newApp);
}
