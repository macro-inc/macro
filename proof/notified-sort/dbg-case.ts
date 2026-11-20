// Replays chosen read cases of a seed on main's reader, the branch's, and
// main's GraphQL reader, printing the spec and the chosen field per entity.
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { generateReads } from './lib/gen.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const seed = Number(process.env.PROOF_SEED ?? 1310);
const ids = (process.env.DBG_CASES ?? '7,23').split(',').map(Number);
const fieldName = process.env.DBG_FIELD ?? 'updatedAt';
const kind = process.env.DBG_KIND ?? 'email';
const out = join(here, 'out/dbg-shared');
const stack = stackFromEnv();
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, { seed, lanes: Number(process.env.DBG_LANES ?? 2), sizes: (process.env.DBG_SIZES ?? '0,1,101').split(',').map(Number), outDir: join(here, process.env.DBG_WORLD ?? 'out/smoke/world'), repo: process.env.PROOF_REPO ?? '', instance: 'gqlns', log: console.log, reuse: true });
const cases = generateReads(seeded.world, new Rng(seed * 101 + 3), Number(process.env.DBG_READS ?? 60));
const [oldApp, newApp] = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', 30110, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', 30111, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  for (const c of cases.filter((x) => ids.includes(x.id))) {
    const user = seeded.users.get(c.viewer)!;
    console.log(JSON.stringify({ case: c.id, viewer: c.viewer, spec: c.spec }));
    const refSpec: ReadSpec = { ...c.spec, params: { ...c.spec.params, sort_method: 'updated_at' } };
    const values: Record<string, Map<string, unknown>> = {};
    for (const [name, app, spec] of [['old', oldApp, c.spec], ['new', newApp, c.spec], ['ref', oldApp, refSpec]] as const) {
      const lane = await openLane(browser, app, user);
      const r = await probeRead(lane, user.macroUserId, spec);
      values[`${name}:${r.transport}`] = new Map(r.entities.filter((e) => (e as { type: string }).type === kind).map((e) => [(e as { id: string }).id, (e as Record<string, unknown>)[fieldName]]));
      if (process.env.DBG_GROUPS) console.log(name, r.transport, JSON.stringify((r.groups ?? []).map((g) => { const x = g as Record<string, unknown>; return [x.id ?? x.key, x.label, Array.isArray(x.items) ? x.items.length : Array.isArray(x.entityIds) ? x.entityIds.length : Object.keys(x).join("|")]; })));
      if (name === 'new') console.log('args', JSON.stringify(r.args).slice(0, 1500));
      await lane.context.close();
    }
    const keys = [...new Set(Object.values(values).flatMap((m) => [...m.keys()]))];
    for (const key of keys) console.log(JSON.stringify({ id: key.slice(0, 13), ...Object.fromEntries(Object.entries(values).map(([k, m]) => [k, m.has(key) ? m.get(key) : '-'])) }));
  }
} finally {
  await browser.close();
  stopApp(oldApp);
  stopApp(newApp);
}
