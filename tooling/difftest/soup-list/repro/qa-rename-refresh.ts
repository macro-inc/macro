/**
 * Repro (bun run repro/qa-rename-refresh.ts [rounds] [kind]): what an in-app
 * rename does to the rest of each side's Quick Access skills (or snippets)
 * list. Per round:
 *
 * 1. another device creates a skill (an API write as the same user) and the
 *    script waits 10 s: does either side's live list show it?
 * 2. the app renames an older skill the user never opened, on both pages at
 *    once as a sequence's in-app step does; for 30 s each side's live feed
 *    (`qa.skills`) and its Quick Access `/` list (`quickAccess`, skill bucket)
 *    are sampled against a fresh load of the same side.
 *
 * Prints, per side, whether the created skill showed before the rename, after
 * it, and whether the renamed skill's position and `updatedAt` match the fresh
 * load. Fresh synthetic user; needs run.sh's two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, openUser, reloadApp, type Side } from '../lib/browser';
import { mount, settle } from '../lib/probe';
const rounds = Number(process.argv[2] ?? 3);
const kind = process.argv[3] === 'snippet' ? 'snippet' : 'skill';
const feed = kind === 'snippet' ? 'qa.snippets' : 'qa.skills';
const tag = Date.now().toString(36);
const email = `owner@wrepro-${tag}.difftest.dev`;
const owner = await new ApiUser('https://localhost:23209', email).login();
const create = async (name: string) => {
  const { documentId } =
    kind === 'skill'
      ? await owner.post<{ documentId: string }>('/dss/documents/create_skill', { skillName: name, description: 'Use when testing renames' })
      : await owner.post<{ documentId: string }>('/dss/documents/create_snippet', { snippetName: name, content: 'repro' });
  return documentId;
};
// Two the user opened and two never opened (oldest first).
const mine: { id: string; name: string }[] = [];
for (let i = 0; i < 4; i++) {
  const name = `Repro ${kind} ${i} ${tag}`;
  mine.push({ id: await create(name), name });
  await Bun.sleep(50);
}
for (const item of mine.slice(2)) await owner.post(`/dss/history/document/${item.id}`);
const ours = new Set(mine.map((m) => m.id));
const probe = { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
const origin = { new: 'http://localhost:23250', old: 'http://localhost:23251' };
const sides: Side[] = ['old', 'new'];
const label = (side: Side) => (side === 'old' ? 'main' : 'branch');
type Row = { id: string; name?: string; timestamps?: { updatedAt?: string }; updatedAt?: unknown };
const pick = (rows: Row[]) => rows.filter((e) => ours.has(e.id)).map((e) => ({ id: e.id.slice(0, 8), name: e.name, updatedAt: e.timestamps?.updatedAt ?? e.updatedAt ?? null }));
const b = await launch();
try {
  const s = await openUser(b, origin, email, probe, owner.browserCookies());
  const read = async (page = s.pages.new, key = 'feed', wait = false) => {
    const snap = await settle(page, key, wait ? { timeoutMs: 60_000 } : { timeoutMs: 500, stableMs: 0 });
    return pick((snap.caller ?? []) as Row[]);
  };
  const mountBoth = async (page: (typeof s.pages)[Side]) => {
    await mount(page, 'feed', feed, {});
    await mount(page, 'qa', 'quickAccess', { buckets: [kind] });
  };
  for (const side of sides) await mountBoth(s.pages[side]);
  for (const side of sides) await read(s.pages[side], 'feed', true), await read(s.pages[side], 'qa', true);
  const out: unknown[] = [];
  for (let r = 0; r < rounds; r++) {
    const name = `Elsewhere ${kind} ${r} ${tag}`;
    const id = await create(name);
    ours.add(id);
    await Bun.sleep(10_000);
    const before: Record<string, unknown> = {};
    for (const side of sides) before[label(side)] = { feed: (await read(s.pages[side])).some((e) => e.id === id.slice(0, 8)), quickAccess: (await read(s.pages[side], 'qa')).some((e) => e.id === id.slice(0, 8)) };
    // An unopened skill of ours, renamed in the app on both pages.
    const target = mine[r % 2];
    const newName = `Renamed ${r} ${tag}`;
    const t0 = Date.now();
    const writes = await Promise.all(sides.map((side) =>
      s.pages[side].evaluate(async (p) => {
        try { await (window as any).__probe.write('rename', p); return 'ok'; } catch (e) { return String(e).slice(0, 120); }
      }, { id: target.id, type: 'document', name: newName, oldName: target.name })));
    target.name = newName;
    const samples: Record<string, [number, unknown][]> = {};
    while (Date.now() - t0 < 30_000) {
      for (const side of sides) for (const key of ['feed', 'qa']) (samples[`${label(side)} ${key}`] ??= []).push([Date.now() - t0, await read(s.pages[side], key)]);
      await Bun.sleep(250);
    }
    // A fresh load of each side: a second page of the same app.
    const fresh: Record<string, unknown> = {};
    for (const side of sides) {
      const page = await s.context.newPage();
      await page.goto(new URL('/app', origin[side]).href, { waitUntil: 'domcontentloaded' });
      await reloadApp({ ...s, pages: { ...s.pages, [side]: page } } as typeof s, side, probe[side]);
      await mountBoth(page);
      fresh[`${label(side)} feed`] = await read(page, 'feed', true);
      fresh[`${label(side)} qa`] = await read(page, 'qa', true);
      await page.close();
    }
    const result: Record<string, unknown> = {};
    for (const [k, xs] of Object.entries(samples)) {
      const want = JSON.stringify(fresh[k]);
      let at: number | undefined;
      for (let i = xs.length - 1; i >= 0 && JSON.stringify(xs[i][1]) === want; i--) at = xs[i][0];
      const last = xs.at(-1)?.[1] as { id: string }[];
      result[k] = { convergedMs: at ?? null, showsCreated: last.some((e) => e.id === id.slice(0, 8)), live: at == null ? last : undefined, fresh: at == null ? fresh[k] : undefined };
    }
    out.push({ round: r, writes: writes.join('/'), createdShownBeforeRename: before, afterRename: result });
    console.error(JSON.stringify(out.at(-1)));
  }
  console.log(JSON.stringify({ kind, rounds: out }, null, 1));
  await s.context.close();
} finally {
  await closeBrowser();
}
