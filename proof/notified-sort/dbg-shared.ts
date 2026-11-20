// Two observers on one Soup list key: does the second one page, and does a
// refresh keep the first one's pages? Main's GraphQL reader (update-time
// sort) against the branch's, and main's REST reader for reference.
import { join } from 'node:path';
import { launchBrowser, openLane, probeOpenLive, probeRead, probeSnapLive, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/dbg-shared');
const stack = stackFromEnv();
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, { seed: Number(process.env.PROOF_SEED ?? 1310), lanes: 2, sizes: [0, 1, 101], outDir: join(here, 'out/smoke/world'), repo: process.env.PROOF_REPO ?? '', instance: 'gqlns', log: console.log, reuse: true });
const [oldApp, newApp] = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', 30110, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', 30111, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  const user = seeded.users.get(process.env.DBG_VIEWER ?? 'n101')!;
  const src: ReadSpec['source'] = { kind: 'filter', filters: {}, confined: false };
  for (const sort of ['notified_at', 'updated_at']) {
    for (const app of [oldApp, newApp]) {
      const lane = await openLane(browser, app, user);
      const spec: ReadSpec = { source: src, params: { limit: 8, sort_method: sort } };
      const alone = await probeRead(lane, user.macroUserId, { ...spec, fresh: true, maxPages: 3 });
      const live = await probeOpenLive(lane, 'x', user.macroUserId, { ...spec, maxPages: 2 });
      const shared = await probeRead(lane, user.macroUserId, { ...spec, fresh: true, maxPages: 3 });
      await lane.page.waitForTimeout(1500);
      const after = await probeSnapLive(lane, 'x');
      console.log(JSON.stringify({ side: lane.side, sort, alone: [alone.transport, alone.entities.length, alone.hasNextPage], live: [live.transport, live.entities.length, live.pages], sharedRead: [shared.entities.length, shared.pages, shared.hasNextPage], liveAfter: after && [after.entities.length, after.hasNextPage] }));
      await lane.context.close();
    }
  }
} finally {
  await browser.close();
  stopApp(oldApp);
  stopApp(newApp);
}
