// Minimal repro: a view recorded on another device reaches a cached (C)
// page's last view only when this session's channel pass rewrites the record.
// One viewer, a C page and an N page; the N page records a view of a joined
// channel; the C page is reloaded and its last view read every 100 ms until
// it equals the primary's. Prints the times, never the session.
// Usage: node repro-view.mjs [group-number] [rounds]
import { launch, load, snapshot, viewerPage } from './pw.mjs';
import { loadGroup } from './group-state.mjs';
import { psql, restTruth } from './rest.mjs';

const number = Number(process.argv[2] ?? 1);
const rounds = Number(process.argv[3] ?? 3);
const group = loadGroup('q', number);
const session = group.sessions[0];
const viewer = group.viewers[0];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const primaryView = async (id) =>
  Number((await psql(`select coalesce(floor(extract(epoch from viewed_at) * 1000)::bigint, 0) from comms_activity where user_id = '${viewer.replaceAll("'", "''")}' and channel_id = '${id}'`)).trim()) || null;
const ms = (value) => (value == null ? null : typeof value === 'number' ? value : Date.parse(value));

const browser = await launch();
const c = await viewerPage(browser, session, { tree: 'branch', mode: 'C' });
const n = await viewerPage(browser, session, { tree: 'branch', mode: 'N' });
await Promise.all([load(c), load(n)]);
const rows = (await restTruth(session)).rows;
console.log(`viewer ${group.label} v1: ${rows.length} joined channels`);
const checkpoint = () =>
  c.page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('graphql-soup-backfill:') && k.endsWith(':channel-directory-reconciled'));
    const saved = key ? JSON.parse(localStorage.getItem(key)) : null;
    return saved && { completed: saved.completed, completedAt: saved.completedAt, scanStartedAt: saved.scanStartedAt, pagesFetched: saved.pagesFetched };
  });
const lastViewOnC = async (id) => (await snapshot(c, { ids: [id], rows: false, lists: false, open: false })).perId[id].lastViewedAt;

for (let round = 0; round < rounds; round++) {
  const id = rows[(round * 7) % rows.length].id;
  const before = await primaryView(id);
  await n.page.evaluate((channelId) => window.__proof.recordView(channelId), id);
  let after = before;
  for (let i = 0; i < 80 && after === before; i++) {
    await sleep(100);
    after = await primaryView(id);
  }
  const live = await lastViewOnC(id);
  const reloadStarted = Date.now();
  await load(c, { reload: true });
  const readyMs = Date.now() - reloadStarted;
  const first = await lastViewOnC(id);
  const firstCheckpoint = await checkpoint();
  let converged = ms(first) === ms(after) ? 0 : null;
  let latest = first;
  while (converged === null && Date.now() - reloadStarted < 60_000) {
    await sleep(100);
    latest = await lastViewOnC(id);
    if (ms(latest) === ms(after)) converged = Date.now() - reloadStarted;
  }
  console.log(JSON.stringify({
    round,
    channel: id,
    primaryBefore: before,
    primaryAfter: after,
    cLive: live,
    cAfterReload: first,
    cAfterReloadEqualsPrimary: ms(first) === ms(after),
    reloadReadyMs: readyMs,
    convergedMsAfterReload: converged,
    checkpointAtFirstRead: firstCheckpoint,
    checkpointAtEnd: await checkpoint(),
  }));
}
await browser.close();
