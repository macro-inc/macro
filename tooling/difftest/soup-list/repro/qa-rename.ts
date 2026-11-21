/**
 * Repro (bun run repro/qa-rename.ts [rounds] [reader]): renames skills in the
 * app and checks whether each side's live Quick Access list (default
 * qa.skills; qa.snippets works the same) reaches what a reload of that side
 * shows: ids in order and names. Three modes per round: only main's app
 * renames, only the branch's does, and both do at once, as a sequence's
 * in-app step does. The list sorts by viewed_updated, and the setup views the
 * skills oldest first, so a rename can reorder it. Prints per mode and side how
 * many rounds converged within 4 s, later (by 30 s) or never, and for a miss
 * what differed. Fresh synthetic user; needs run.sh's two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, openUser, reloadApp, type Side } from '../lib/browser';
import { mount, settle, write } from '../lib/probe';
const rounds = Number(process.argv[2] ?? 4);
const reader = process.argv[3] ?? 'qa.skills';
const kind = reader === 'qa.snippets' ? 'snippet' : 'skill';
const tag = Date.now().toString(36);
const email = `owner@wrepro-${tag}.difftest.dev`;
const owner = await new ApiUser('https://localhost:23209', email).login();
const items: { id: string; name: string }[] = [];
for (let i = 0; i < 6; i++) {
  const name = `Repro ${kind} ${i} ${tag}`;
  const { documentId } =
    kind === 'skill'
      ? await owner.post<{ documentId: string }>('/dss/documents/create_skill', { skillName: name, description: 'Use when testing renames' })
      : await owner.post<{ documentId: string }>('/dss/documents/create_snippet', { snippetName: name, content: 'repro' });
  items.push({ id: documentId, name });
}
for (const item of items) {
  await owner.post(`/dss/history/document/${item.id}`);
  await Bun.sleep(50);
}
const probe = { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
const sides: Side[] = ['old', 'new'];
const label = (side: Side) => (side === 'old' ? 'main' : 'branch');
const b = await launch();
try {
  const s = await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email, probe, owner.browserCookies());
  const view = async (side: Side, settled = false) => {
    const snap = await settle(s.pages[side], 'qa', settled ? { timeoutMs: 60_000 } : { timeoutMs: 500, stableMs: 0 });
    const list = (snap.caller ?? []) as { id: string; name?: string }[];
    return list.filter((e) => items.some((i) => i.id === e.id)).map((e) => `${e.id.slice(0, 8)}:${e.name}`);
  };
  for (const side of sides) await mount(s.pages[side], 'qa', reader, {});
  for (const side of sides) await view(side, true);
  const tally: Record<string, Record<string, number>> = {};
  const misses: unknown[] = [];
  const writes: Record<string, string[]> = {};
  for (let r = 0; r < rounds; r++) {
    for (const mode of ['old', 'new', 'both'] as const) {
      // The oldest-viewed item, so a rename moves it to the top.
      const live0 = await view('new');
      const item = items.find((i) => live0.at(-1)?.startsWith(i.id.slice(0, 8))) ?? items[0];
      const name = `Renamed ${mode} ${r} ${tag}`;
      const writers: Side[] = mode === 'both' ? sides : [mode];
      const t0 = Date.now();
      const results = await Promise.all(writers.map((side) =>
        write(s.pages[side], 'rename', { id: item.id, type: 'document', name, oldName: item.name }).then((w) => (w.ok ? 'ok' : String(w.error).slice(0, 120)))));
      (writes[mode] ??= []).push(results.join('/'));
      item.name = name;
      // Every 200 ms for 30 s, each side's live list.
      const samples: Record<Side, [number, string[]][]> = { old: [], new: [] };
      while (Date.now() - t0 < 30_000) {
        for (const side of sides) samples[side].push([Date.now() - t0, await view(side)]);
        await Bun.sleep(200);
      }
      // What each side shows once its rows are read fresh: a second page of the same app.
      const truth: Partial<Record<Side, string[]>> = {};
      for (const side of sides) {
        const fresh = await s.context.newPage();
        await fresh.goto(new URL("/app", side === "old" ? "http://localhost:23251" : "http://localhost:23250").href, { waitUntil: "domcontentloaded" });
        await reloadApp({ ...s, pages: { ...s.pages, [side]: fresh } } as typeof s, side, probe[side]);
        await mount(fresh, "qa", reader, {});
        const snap = await settle(fresh, "qa", { timeoutMs: 60_000 });
        truth[side] = ((snap.caller ?? []) as { id: string; name?: string }[])
          .filter((e) => items.some((i) => i.id === e.id)).map((e) => `${e.id.slice(0, 8)}:${e.name}`);
        await fresh.close();
      }
      // Converged at the first sample from which every later one equals the fresh read.
      const seenAt: Partial<Record<Side, number>> = {};
      const last: Partial<Record<Side, string[]>> = {};
      for (const side of sides) {
        const xs = samples[side];
        last[side] = xs.at(-1)?.[1];
        let at: number | undefined;
        for (let i = xs.length - 1; i >= 0 && JSON.stringify(xs[i][1]) === JSON.stringify(truth[side]); i--) at = xs[i][0];
        seenAt[side] = at;
      }
      for (const side of sides) {
        const ms = seenAt[side];
        const k = ms == null ? 'never' : ms <= 4000 ? 'within 4 s' : 'later';
        const row = (tally[`${mode === 'both' ? 'both' : label(mode)} renames, ${label(side)} list`] ??= {});
        row[k] = (row[k] ?? 0) + 1;
        if (ms == null) misses.push({ round: r, mode, side: label(side), live: last[side], fresh: truth[side] });
      }
    }
  }
  console.log(JSON.stringify({ reader, tally, writes, misses }, null, 1));
  await s.context.close();
} finally {
  await closeBrowser();
}
