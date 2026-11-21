// Why a mounted Home list misses its own fresh read: one lane viewer's Home
// Signal list stays mounted on each side; before any write, and after one
// write step (DBG_KIND, default done; DBG_ENTITY limits it to one world key),
// print where each side's live list parts from a fresh network read of the
// same list, every two seconds.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runStep, type ActionContext, type StepKind } from './lib/actions.ts';
import { launchBrowser, openLane, probeOpenLive, probeRead, probeSnapLive, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { discrepancies, project, rowsDiff, sameRows } from './lib/project.ts';
import { Rng } from './lib/rng.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-live');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const portBase = Number(process.env.PROOF_PORT_BASE ?? 30110);
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seed = Number(process.env.PROOF_SEED ?? 2601);
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
const viewerKey = process.env.DBG_LANE ?? 'v0';
const user = seeded.users.get(viewerKey)!;
// DBG_SPEC (a JSON file holding one ReadSpec) replaces the Home list; DBG_GROUP
// (entity_type, date, project) groups whichever list is watched.
const homeSpec: ReadSpec = { source: { kind: 'home', tab: (process.env.DBG_TAB as 'signal' | 'noise') ?? 'signal', facets: {}, foreignEntities: true }, maxPages: 1 };
const baseSpec: ReadSpec = process.env.DBG_SPEC ? JSON.parse(readFileSync(process.env.DBG_SPEC, 'utf8')) : homeSpec;
const spec: ReadSpec = process.env.DBG_GROUP ? { ...baseSpec, groupBy: { type: process.env.DBG_GROUP } } : baseSpec;
const apps = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', portBase, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', portBase + 1, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  const live = await Promise.all(apps.map((app) => openLane(browser, app, user)));
  const raw = await Promise.all(apps.map((app) => openLane(browser, app, user)));
  // DBG_ALSO (signal or noise) mounts a second Home list in the live tab first,
  // as a sequence lane does: an entity cached by it is no longer a cache miss.
  const also = process.env.DBG_ALSO as 'signal' | 'noise' | undefined;
  if (also) await Promise.all(live.map((lane) => probeOpenLive(lane, 'y', user.macroUserId, { ...spec, source: { ...spec.source, tab: also } } as ReadSpec)));
  await Promise.all(live.map((lane) => probeOpenLive(lane, 'x', user.macroUserId, spec)));
  let watched: string | undefined;
  const watch = async (label: string, seconds: number) => {
    for (let t = 0; t <= seconds; t += 2) {
      const fresh = await Promise.all(raw.map((lane) => probeRead(lane, user.macroUserId, { ...spec, fresh: true, clean: true })));
      const snaps = await Promise.all(live.map((lane) => probeSnapLive(lane, 'x')));
      const line = [0, 1].map((side) => {
        const a = project(snaps[side]!);
        const b = project(fresh[side]);
        const where = (rows: typeof a) => { const at = rows.findIndex((r) => r.key.endsWith(watched!)); return at < 0 ? "-" : `${at}@${rows[at].notifiedAt}`; };
        const has = watched ? ` live=${where(a)} fresh=${where(b)}` : "";
        return `${side ? 'new' : 'old'}${has} ${sameRows(a, b) ? 'same' : `live ${a.length} fresh ${b.length} settled=${snaps[side]?.settled} ${rowsDiff(a, b)} tokens=${discrepancies(a, b).join(",")}${process.env.DBG_ROWS ? `\n    live:  ${a.map((r) => `${r.key.split(":")[0]}:${r.key.slice(-6)}@${r.notifiedAt?.slice(11, 23)}`).join(" ")}\n    fresh: ${b.map((r) => `${r.key.split(":")[0]}:${r.key.slice(-6)}@${r.notifiedAt?.slice(11, 23)}`).join(" ")}` : ""}`}`;
      });
      console.log(`${label} t=${t}s | ${line.join(' | ')}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  // DBG_KIND and DBG_ENTITY may list several steps, comma-separated, run in
  // order with a watch after each; DBG_ROWS=1 prints both lists when they part.
  const kinds = (process.env.DBG_KIND ?? 'done').split(',');
  const only = (process.env.DBG_ENTITY ?? '').split(',');
  if (only[0]) watched = seeded.world.entities.find((e) => e.key === only[0])?.id;
  await watch('before', 6);
  for (const [n, kind] of kinds.entries()) {
    const key = only[n] || only[0];
    const world = key ? { ...seeded.world, entities: seeded.world.entities.filter((e) => e.key === key) } : seeded.world;
    const ctx: ActionContext = { stack, queueUrl: process.env.PROOF_QUEUE_URL ?? '', world, users: seeded.users, viewer: viewerKey, rng: new Rng(Number(process.env.DBG_RNG ?? 7) + n), created: [] };
    const step = await runStep(ctx, kind as StepKind);
    watched = (seeded.world.entities.find((e) => e.key === step.entity) ?? ctx.created.find((e) => e.key === step.entity))?.id;
    console.log(`step ${n} ${JSON.stringify(step)} id ${watched}`);
    await watch(`after${n}`, Number(process.env.DBG_AFTER ?? 16));
  }
} finally {
  await browser.close();
  for (const app of apps) stopApp(app);
}
