// Home under a notification storm: the 2000-entity viewer of a seeded world
// opens Home Signal on main and on the branch, then DBG_RATE notifications a
// second (default 15, as the loaded run's six notifiers wrote) go to that
// viewer for DBG_SECONDS (default 90), and as long again after. Every 3 s it
// prints each side's Home row count, and at the end, per side,
// the Soup requests each page sent and how many failed, before and during the
// storm. A screenshot of each side is kept at the storm's middle.
//
// DBG_TOUCH=0 opens desktop Home (grouped, REST on both sides) instead of
// touch Home (flat). With DBG_READS=1 the pages open on desktop too, and every round each
// side reads Home Signal flat (as the reads phase does first) and then
// grouped by project, page size 13 (read 369 of the loaded run), through its
// own facade; each read's rows and error are printed. Runs with PROOF_NETNS=0.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, readHomeDom, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { queueNotify } from './lib/notify.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld, sender } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const reads = process.env.DBG_READS === '1';
const touch = !reads && process.env.DBG_TOUCH !== '0';
const out = join(here, `out/dbg-storm${reads ? '-reads' : touch ? '' : '-desktop'}`);
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 3702),
  lanes: 24,
  sizes: [0, 1, 100, 101, 2000],
  outDir: join(here, process.env.DBG_WORLD ?? 'out/load/world'),
  repo: process.env.PROOF_REPO ?? '',
  instance: stack.instance,
  log: () => undefined,
  reuse: true,
});
const viewerKey = process.env.DBG_VIEWER ?? 'n2000';
const user = seeded.users.get(viewerKey)!;
const targets = seeded.world.entities.filter((e) => e.viewer === viewerKey);
const rate = Number(process.env.DBG_RATE ?? 15);
const seconds = Number(process.env.DBG_SECONDS ?? 90);
const flat: ReadSpec = { source: { kind: 'preset', tab: 'signal' }, params: { limit: 13, sort_method: 'notified_at', sort_direction: 'desc' }, showForeign: true, maxPages: 3 };
const grouped: ReadSpec = { ...flat, groupBy: { type: 'project' }, maxPages: 1 };
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
const at = () => new Date().toISOString();
type Counts = Record<string, number>;
const requests = { old: {} as Counts, new: {} as Counts };
const readTally = { old: {} as Counts, new: {} as Counts };
const bump = (into: Counts, key: string) => (into[key] = (into[key] ?? 0) + 1);
try {
  const lanes = await Promise.all(apps.map((app) => openLane(browser, app, user, { touch: touch, path: '/app/home?s0.home.tab=signal' })));
  for (const lane of lanes) {
    const side = lane.side as 'old' | 'new';
    lane.page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.includes('/items/soup')) bump(requests[side], `sent ${r.method()} ${path}`);
    });
    lane.page.on('crash', () => console.log(`${new Date().toISOString()} ${side} page crashed`));
    lane.page.on('requestfailed', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.includes('/items/soup')) bump(requests[side], `failed ${r.failure()?.errorText} ${path}`);
    });
  }
  await Promise.all(lanes.map((lane) => lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 })));
  const count = async () => Promise.all(lanes.map((lane) => readHomeDom(lane).then((rows) => rows.filter((r) => r.kind === 'entity').length, () => -1)));
  const readBoth = async () => {
    const results = await Promise.all(
      lanes.map(async (lane) => {
        const side = lane.side as 'old' | 'new';
        const line: string[] = [];
        for (const [name, spec] of [['flat', flat], ['grouped', grouped]] as const) {
          const r = await probeRead(lane, user.macroUserId, spec).then(
            (v) => ({ n: v.entities.length, error: v.error ? String(v.error).slice(0, 60) : null }),
            (e) => ({ n: -1, error: `rejected ${String(e).slice(0, 80)}` })
          );
          bump(readTally[side], `${name} ${r.error ?? 'ok'}`);
          line.push(`${name}=${r.n}${r.error ? ` (${r.error})` : ''}`);
        }
        return `${side}: ${line.join(' ')}`;
      })
    );
    return results.join(' | ');
  };
  // Let both settle before the storm.
  await new Promise((r) => setTimeout(r, 10_000));
  console.log(`${at()} before storm: ${reads ? await readBoth() : `rows ${(await count()).join('/')}`}`);
  const beforeStorm = JSON.parse(JSON.stringify(requests));
  const rng = new Rng(77);
  let sent = 0;
  let running = true;
  const notifier = (async () => {
    const started = Date.now();
    while (running && Date.now() - started < seconds * 1000) {
      const tick = Date.now();
      const batch = Array.from({ length: rate }, () => rng.pick(targets));
      await Promise.all(batch.map((entity) => queueNotify(stack, process.env.PROOF_QUEUE_URL ?? '', entity, [user.macroUserId], sender(seeded.world, entity), rng, { waitMs: 1 }).then(() => (sent += 1), () => undefined)));
      await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - tick))));
    }
  })();
  const started = Date.now();
  let shot = false;
  while (Date.now() - started < seconds * 2000) {
    const t = Math.round((Date.now() - started) / 1000);
    const phase = t < seconds ? 'storm' : 'after';
    console.log(`${at()} t=${t}s ${phase} sent=${sent} rows old=${(await count()).join(' new=')}${reads ? ` reads ${await readBoth()}` : ''}`);
    if (!shot && t >= seconds / 2) {
      shot = true;
      for (const lane of lanes) await lane.page.screenshot({ path: join(out, `${lane.side}-mid-storm.png`) }).catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  running = false;
  await notifier;
  console.log(JSON.stringify({ beforeStorm, total: requests, reads: readTally }, null, 1));
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
