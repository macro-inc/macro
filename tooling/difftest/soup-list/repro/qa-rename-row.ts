/**
 * Repro (bun run repro/qa-rename-row.ts [rounds] [kind]): the one row an
 * in-app rename changes, in each side's Quick Access skills (or snippets)
 * feed (`qa.skills`) and in Quick Access itself (`quickAccess`, that bucket).
 * A fresh user makes four, opens the last two, then per round renames an
 * unopened one in the app on both pages and samples for 90 s: the row's name
 * (or search text), `updatedAt`, `sortTimestamp` and position, against a fresh
 * load of the same side. The `/` menu (`menu`) mounts two seconds after the
 * rename, as a user would open it. Needs run.sh's two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, openUser, reloadApp, type Side } from '../lib/browser';
import { mount, settle, unmount, write } from '../lib/probe';
const rounds = Number(process.argv[2] ?? 2);
const kind = process.argv[3] === 'snippet' ? 'snippet' : 'skill';
const feedReader = kind === 'snippet' ? 'qa.snippets' : 'qa.skills';
const tag = Date.now().toString(36);
const email = `owner@wrow-${tag}.difftest.dev`;
const owner = await new ApiUser('https://localhost:23209', email).login();
const create = async (name: string) =>
  (kind === 'skill'
    ? await owner.post<{ documentId: string }>('/dss/documents/create_skill', { skillName: name, description: 'Use when testing renames' })
    : await owner.post<{ documentId: string }>('/dss/documents/create_snippet', { snippetName: name, content: 'repro' })
  ).documentId;
const mine: { id: string; name: string }[] = [];
for (let i = 0; i < 4; i++) {
  const name = `Row ${kind} ${i} ${tag}`;
  mine.push({ id: await create(name), name });
  await Bun.sleep(50);
}
for (const item of mine.slice(2)) await owner.post(`/dss/history/document/${item.id}`);
const probe = { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
const origin = { new: 'http://localhost:23250', old: 'http://localhost:23251' };
const sides: Side[] = ['old', 'new'];
const label = (side: Side) => (side === 'old' ? 'main' : 'branch');
type Row = { id: string; name?: string; searchText?: string; timestamps?: { updatedAt?: string }; updatedAt?: unknown; sortTimestamp?: number };
const ms = (v: unknown) => (v == null ? null : new Date(String(v)).getTime());
const b = await launch();
try {
  const s = await openUser(b, origin, email, probe, owner.browserCookies());
  const rowOf = async (page: (typeof s.pages)[Side], key: string, id: string, wait = false) => {
    const snap = await settle(page, key, wait ? { timeoutMs: 60_000 } : { timeoutMs: 500, stableMs: 0 });
    const rows = ((snap.caller ?? []) as Row[]).filter((e) => mine.some((m) => m.id === e.id));
    const at = rows.findIndex((e) => e.id === id);
    if (at < 0) return { at: -1 };
    const e = rows[at];
    return { at, of: rows.length, name: e.name ?? e.searchText?.slice(0, 40), updatedAt: ms(e.timestamps?.updatedAt ?? e.updatedAt), sort: e.sortTimestamp ?? null };
  };
  const mountBoth = async (page: (typeof s.pages)[Side]) => {
    await mount(page, 'feed', feedReader, {});
    await mount(page, 'qa', 'quickAccess', { buckets: [kind] });
  };
  // Timeline: each cache change (with the search buckets it touched) and each
  // start of a history read, from before the feeds mount.
  for (const side of sides)
    await s.pages[side].evaluate(async () => {
      const w = window as any;
      const { queryClient } = await import('/src/lib/queries/client.ts');
      const { getGraphqlSoupCacheHost } = await import('/src/lib/service-clients/service-storage/graphql-soup.ts');
      w.__timeline = [];
      const t = () => Math.round(performance.now());
      queryClient.getQueryCache().subscribe((e: any) => {
        if (e.type === 'updated' && e.action?.type === 'fetch' && e.query.queryKey[0] === 'history')
          w.__timeline.push([t(), 'history fetch', String(e.query.queryKey[1] ?? '')]);
      });
      getGraphqlSoupCacheHost()?.onCacheChanged(
        (_r: unknown, c: any) => w.__timeline.push([t(), 'cache change', (c?.searchChangedBuckets ?? ['?']).join(',')]),
        { includeHydration: true }
      );
    });
  for (const side of sides) await mountBoth(s.pages[side]);
  for (const side of sides) for (const key of ['feed', 'qa']) await rowOf(s.pages[side], key, mine[0].id, true);
  const out: unknown[] = [];
  for (let r = 0; r < rounds; r++) {
    const target = mine[r % 2];
    const newName = `Renamed row ${r} ${tag}`;
    const t0 = Date.now();
    const renameAt: Record<string, number> = {};
    for (const side of sides) renameAt[side] = await s.pages[side].evaluate(() => Math.round(performance.now()));
    const writes = await Promise.all(sides.map((side) =>
      write(s.pages[side], 'rename', { id: target.id, type: 'document', name: newName, oldName: target.name }).then((w) => (w.ok ? 'ok' : String(w.error).slice(0, 120)))));
    target.name = newName;
    // The user opens the `/` menu two seconds after the rename.
    await Bun.sleep(2_000);
    for (const side of sides) await mount(s.pages[side], 'menu', 'quickAccess', { buckets: [kind], menu: true });
    const samples: Record<string, [number, string][]> = {};
    while (Date.now() - t0 < 90_000) {
      for (const side of sides) for (const key of ['feed', 'qa', 'menu']) {
        const v = JSON.stringify(await rowOf(s.pages[side], key, target.id));
        const xs = (samples[`${label(side)} ${key}`] ??= []);
        if (xs.at(-1)?.[1] !== v) xs.push([Date.now() - t0, v]);
      }
      await Bun.sleep(250);
    }
    for (const side of sides) await unmount(s.pages[side], 'menu');
    const timeline: Record<string, unknown> = {};
    for (const side of sides)
      timeline[label(side)] = await s.pages[side].evaluate(
        (at) => (window as any).__timeline.filter((e: [number]) => e[0] > at - 70_000).map(([ms, what, detail]: [number, string, string]) => [ms - at, what, detail]),
        renameAt[side]
      );
    const fresh: Record<string, string> = {};
    for (const side of sides) {
      const page = await s.context.newPage();
      await page.goto(new URL('/app', origin[side]).href, { waitUntil: 'domcontentloaded' });
      await reloadApp({ ...s, pages: { ...s.pages, [side]: page } } as typeof s, side, probe[side]);
      await mountBoth(page);
      await mount(page, 'menu', 'quickAccess', { buckets: [kind], menu: true });
      for (const key of ['feed', 'qa', 'menu']) fresh[`${label(side)} ${key}`] = JSON.stringify(await rowOf(page, key, target.id, true));
      await page.close();
    }
    const result = Object.fromEntries(Object.entries(samples).map(([k, xs]) => [k, { changes: xs, fresh: fresh[k], matchesFresh: xs.at(-1)?.[1] === fresh[k] }]));
    out.push({ round: r, writes: writes.join('/'), renamedAtMs: Date.now() - t0, rows: result, timeline });
    console.error(JSON.stringify(out.at(-1)));
  }
  console.log(JSON.stringify({ kind, rounds: out }, null, 1));
  await s.context.close();
} finally {
  await closeBrowser();
}
