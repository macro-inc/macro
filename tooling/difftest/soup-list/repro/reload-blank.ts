/**
 * Repro (bun run repro/reload-blank.ts [pairs] [rounds]): how often a reload
 * leaves the app blank, and what a blank page is waiting on. Opens `pairs`
 * signed-in users (each a context with main's and the branch's page, as a
 * sequence lane does), reloads every page at once `rounds` times, and for each
 * page reports how long the app took to render and the probe to load. A page
 * not rendered after 120 s is described: its readyState, the Web Locks it
 * holds and waits on, its console errors since the reload, and its open
 * requests.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, openUser, type Side, type UserSession } from '../lib/browser';
import { pendingRequests } from '../lib/inflight';

const pairs = Number(process.argv[2] ?? 4);
const rounds = Number(process.argv[3] ?? 6);
const tag = Date.now().toString(36);
const b = await launch();
const sides: Side[] = ['old', 'new'];
const label = (side: Side) => (side === 'old' ? 'main' : 'branch');
const paths = { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
try {
  const sessions: UserSession[] = [];
  for (let i = 0; i < pairs; i++) {
    const email = `owner@wreload-${tag}-${i}.difftest.dev`;
    const user = await new ApiUser('https://localhost:23209', email).login();
    sessions.push(await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email, paths, user.browserCookies()));
    console.log(`opened pair ${i}`);
  }
  const errors = new Map<unknown, string[]>();
  for (const s of sessions)
    for (const side of sides) {
      const page = s.pages[side];
      errors.set(page, []);
      page.on('console', (m) => m.type() === 'error' && errors.get(page)!.push(m.text().slice(0, 160)));
      page.on('pageerror', (e) => errors.get(page)!.push(String(e).slice(0, 160)));
    }
  const tally = { old: { ok: 0, blank: 0 }, new: { ok: 0, blank: 0 } };
  for (let round = 0; round < rounds; round++) {
    const results = await Promise.all(
      sessions.flatMap((s, i) =>
        sides.map(async (side) => {
          const page = s.pages[side];
          errors.set(page, []);
          const t0 = Date.now();
          // What a page still waits on 60 s into its reload, newest first.
          const at60 = new Promise<string[]>((r) => setTimeout(() => r(pendingRequests(page, 20_000)), 60_000));
          const reloaded = page.reload({ waitUntil: 'domcontentloaded' }).then(() => Date.now() - t0, () => undefined);
          const domMs = await reloaded;
          const rendered = await page
            .waitForFunction(() => (document.body?.innerText ?? '').trim().length > 0, null, { timeout: 120_000, polling: 500 })
            .then(() => Date.now() - t0, () => undefined);
          const probe = rendered === undefined ? undefined : await page
            .evaluate(async (p) => { await import(/* @vite-ignore */ p); return true; }, paths[side])
            .then(() => Date.now() - t0, (e) => `probe failed: ${String(e).slice(0, 100)}`);
          if (rendered !== undefined) {
            tally[side].ok++;
            return `round ${round} pair ${i} ${label(side)}: domcontentloaded ${domMs} ms, rendered ${rendered} ms, probe ${probe}${rendered > 60_000 ? ` waiting at 60 s on ${JSON.stringify(await at60)}` : ''}`;
          }
          tally[side].blank++;
          const state = await Promise.race([
            page.evaluate(async () => ({
              ready: document.readyState,
              locks: await navigator.locks.query().then((q) => ({ held: q.held?.map((l) => l.name), pending: q.pending?.map((l) => l.name) })),
            })),
            new Promise((r) => setTimeout(() => r('evaluate did not answer in 10 s'), 10_000)),
          ]).catch((e) => `evaluate failed: ${e}`);
          return `round ${round} pair ${i} ${label(side)}: BLANK after 120 s ${JSON.stringify(state)} errors ${JSON.stringify(errors.get(page)!.slice(-4))} open ${JSON.stringify(pendingRequests(page))}`;
        })
      )
    );
    for (const line of results) console.log(line);
    // Put blank pages back for the next round.
    for (const s of sessions)
      for (const side of sides) {
        const empty = await s.pages[side].evaluate(() => (document.body?.innerText ?? '').trim().length === 0).catch(() => true);
        if (empty) await s.pages[side].goto(`${side === 'old' ? 'http://localhost:23251' : 'http://localhost:23250'}/app`).catch(() => {});
      }
  }
  console.log(JSON.stringify(tally));
} finally {
  await closeBrowser();
}
