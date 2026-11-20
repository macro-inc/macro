// Email updatedAt per reader: main's REST notified list, the branch's GraphQL
// notified list, and main's GraphQL update-time list, against the row.
import { join } from 'node:path';
import { launchBrowser, openLane, probeRead, startApp, stopApp, type ReadSpec } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { sql, stackFromEnv } from './lib/stack.ts';

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
  for (const key of ['v0', 'v1']) {
    const user = seeded.users.get(key)!;
    const src: ReadSpec['source'] = { kind: 'filter', filters: {}, confined: false };
    const reads: Record<string, Map<string, unknown>> = {};
    for (const [name, app, sort] of [['old-rest-notified', oldApp, 'notified_at'], ['new-gql-notified', newApp, 'notified_at'], ['old-gql-updated', oldApp, 'updated_at'], ['new-gql-updated', newApp, 'updated_at']] as const) {
      const lane = await openLane(browser, app, user);
      const r = await probeRead(lane, user.macroUserId, { source: src, params: { limit: 100, sort_method: sort }, fresh: true, maxPages: 5 });
      reads[`${name}:${r.transport}`] = new Map(r.entities.filter((e) => (e as { type: string }).type === 'email').map((e) => [(e as { id: string }).id, [(e as { updatedAt: unknown }).updatedAt, (e as { sortTs: unknown }).sortTs]]));
      await lane.context.close();
    }
    const ids = [...new Set(Object.values(reads).flatMap((m) => [...m.keys()]))];
    const rows = await sql<{ id: string; updated_at: string; latest: string }>(stack, `SELECT id::text, updated_at::text, latest_non_spam_message_ts::text AS latest FROM email_threads WHERE id IN (${ids.map((i) => `'${i}'`).join(',')})`);
    for (const row of rows) console.log(JSON.stringify({ viewer: key, id: row.id.slice(0, 13), row: [row.updated_at, row.latest], ...Object.fromEntries(Object.entries(reads).map(([k, m]) => [k, m.get(row.id) ?? null])) }));
  }
} finally {
  await browser.close();
  stopApp(oldApp);
  stopApp(newApp);
}
