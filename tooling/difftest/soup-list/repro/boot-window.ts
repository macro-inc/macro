/**
 * Repro (bun run repro/boot-window.ts [rounds] [write]): a write from another
 * device right after both apps reload, against a generic Soup list
 * (`useSoupAstItemsQuery`, the `ast` reader) mounted on each. This is what a
 * sequence step after a reload does. Per round: reload both pages, mount and
 * settle the list, then delete (or, with `create`, add) a document through the
 * API, and watch each side for 40 s. Prints per side when the list showed the
 * write (or never), and where that side's GraphQL cache started its engine
 * (`graphql_cache.wasm_download`) relative to the write. Fresh synthetic user;
 * needs run.sh's two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, loadProbe, openUser, type Side } from '../lib/browser';
import { pageLoad } from '../lib/inflight';
import { mount, settle, unmount } from '../lib/probe';
const rounds = Number(process.argv[2] ?? 6);
const write = process.argv[3] === 'create' ? 'create' : 'delete';
const tag = Date.now().toString(36);
const email = `owner@wrepro-${tag}.difftest.dev`;
const owner = await new ApiUser('https://localhost:23209', email).login();
const createDoc = async (name: string) =>
  (await owner.post<{ documentId: string }>('/dss/documents/create_markdown', { documentName: name, markdown: 'repro', skipHistory: true })).documentId;
const docs: string[] = [];
for (let i = 0; i < 20; i++) docs.push(await createDoc(`Boot ${i} ${tag}`));
const args = { args: { params: { limit: 50, sort_method: 'created_at' }, body: {} }, options: {}, pages: 1 };
const probe = { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
const sides: Side[] = ['old', 'new'];
const label = (side: Side) => (side === 'old' ? 'main' : 'branch');
const ids = async (side: Side, s: Awaited<ReturnType<typeof openUser>>, wait = false) => {
  const snap = await settle(s.pages[side], 'list', wait ? { timeoutMs: 60_000 } : { timeoutMs: 500, stableMs: 0 });
  const data = snap.data as { entities?: { id: string }[] } | null;
  return { ids: (data?.entities ?? []).map((e) => e.id), error: (snap.status as { error?: string } | undefined)?.error ?? null };
};
const b = await launch();
try {
  const s = await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email, probe, owner.browserCookies());
  for (const side of sides) await mount(s.pages[side], 'list', 'ast', args);
  for (const side of sides) await ids(side, s, true);
  const out: unknown[] = [];
  const tally: Record<string, Record<string, number>> = {};
  for (let r = 0; r < rounds; r++) {
    for (const side of sides) await unmount(s.pages[side], 'list');
    const reloadAt = Date.now();
    await Promise.all(sides.map((side) => pageLoad(async () => {
      await s.pages[side].reload({ waitUntil: 'domcontentloaded' });
      await loadProbe(s, side, probe[side]);
    })));
    for (const side of sides) await mount(s.pages[side], 'list', 'ast', args);
    const settled = await Promise.all(sides.map((side) => ids(side, s, true)));
    const t0 = Date.now();
    let target: string;
    if (write === 'delete') {
      target = docs.pop() as string;
      await owner.del(`/dss/documents/${target}`);
    } else target = await createDoc(`Boot created ${r} ${tag}`);
    const shown = (list: string[]) => (write === 'delete' ? !list.includes(target) : list.includes(target));
    const at: Partial<Record<Side, number>> = {};
    while (Date.now() - t0 < 40_000 && sides.some((side) => at[side] === undefined)) {
      for (const side of sides) if (at[side] === undefined && shown((await ids(side, s)).ids)) at[side] = Date.now() - t0;
      await Bun.sleep(250);
    }
    await Bun.sleep(3_000); // let the spans of the window export
    const row: Record<string, unknown> = { round: r, reloadToWriteMs: t0 - reloadAt };
    for (const [i, side] of sides.entries()) {
      const boots = s.spans[side].filter((x) => x.name === 'graphql_cache.wasm_download' && x.start !== undefined && x.start >= reloadAt).map((x) => (x.start as number) - t0);
      const ready = s.spans[side].filter((x) => x.name === 'graphql_cache.host_ready' && x.start !== undefined && x.start >= reloadAt).map((x) => (x.start as number) - t0);
      const k = at[side] === undefined ? 'never' : (at[side] as number) <= 8_000 ? 'within 8 s' : 'later';
      const bootWhen = ready.length === 0 ? 'no engine start seen' : ready[0] > 0 ? 'engine ready after the write' : 'engine ready before the write';
      const t = (tally[`${label(side)}, ${bootWhen}`] ??= {});
      t[k] = (t[k] ?? 0) + 1;
      row[label(side)] = { shownMs: at[side] ?? null, rowsBefore: settled[i].ids.length, error: settled[i].error, wasmDownloadMs: boots, hostReadyMs: ready };
    }
    out.push(row);
    console.error(JSON.stringify(row));
  }
  console.log(JSON.stringify({ write, tally, rounds: out }, null, 1));
  await s.context.close();
} finally {
  await closeBrowser();
}
