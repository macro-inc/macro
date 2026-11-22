/**
 * Repro (bun run repro/session-rename-boot.ts [rounds]): renames an agent
 * session in the app right after both apps reload, as a sequence step after a
 * reload does, and times when each side's Quick Access sessions list shows the
 * new name (or never, within 30 s). Per round: reload both pages, mount and
 * settle Quick Access sessions, rename one session on both pages at once,
 * then watch. Prints per side where its GraphQL cache engine became ready
 * (`graphql_cache.host_ready`) relative to the rename, and tallies the result
 * by that. Fresh synthetic user; needs run.sh's two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, loadProbe, openUser, type Side } from '../lib/browser';
import { pageLoad } from '../lib/inflight';
import { mount, settle, unmount, write } from '../lib/probe';
const rounds = Number(process.argv[2] ?? 6);
const tag = Date.now().toString(36);
const email = `owner@wrepro-${tag}.difftest.dev`;
const owner = await new ApiUser('https://localhost:23209', email).login();
const ids: string[] = [];
for (let i = 0; i < 4; i++) {
  const { session } = await owner.post<{ session: { id: string } }>('/agent-harness/agent-sessions', {});
  ids.push(session.id);
}
const probe = { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
const sides: Side[] = ['old', 'new'];
const label = (side: Side) => (side === 'old' ? 'main' : 'branch');
const b = await launch();
try {
  const s = await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email, probe, owner.browserCookies());
  for (const side of sides) await mount(s.pages[side], 'qa', 'qa.agentSessions', {});
  for (const side of sides) await settle(s.pages[side], 'qa', { timeoutMs: 60_000 });
  const names = async (side: Side) => {
    const snap = await settle(s.pages[side], 'qa', { timeoutMs: 500, stableMs: 0 });
    return (snap.caller ?? []) as { id: string; name?: string }[];
  };
  const out: unknown[] = [];
  const tally: Record<string, Record<string, number>> = {};
  for (let r = 0; r < rounds; r++) {
    for (const side of sides) await unmount(s.pages[side], 'qa');
    const reloadAt = Date.now();
    await Promise.all(sides.map((side) => pageLoad(async () => {
      await s.pages[side].reload({ waitUntil: 'domcontentloaded' });
      await loadProbe(s, side, probe[side]);
    })));
    for (const side of sides) await mount(s.pages[side], 'qa', 'qa.agentSessions', {});
    for (const side of sides) await settle(s.pages[side], 'qa', { timeoutMs: 60_000 });
    const id = ids[r % ids.length];
    const name = `Renamed ${r} ${tag}`;
    const t0 = Date.now();
    const writes = await Promise.all(sides.map((side) => write(s.pages[side], 'renameSession', { id, name }).then((w) => (w.ok ? 'ok' : String(w.error).slice(0, 120)))));
    const at: Partial<Record<Side, number>> = {};
    while (Date.now() - t0 < 30_000 && sides.some((side) => at[side] === undefined)) {
      for (const side of sides) if (at[side] === undefined && (await names(side)).some((e) => e.id === id && e.name === name)) at[side] = Date.now() - t0;
      await Bun.sleep(250);
    }
    await Bun.sleep(3_000); // let the spans of the window export
    const row: Record<string, unknown> = { round: r, reloadToWriteMs: t0 - reloadAt, writes: writes.join('/') };
    for (const side of sides) {
      const ready = s.spans[side].filter((x) => x.name === 'graphql_cache.host_ready' && x.start !== undefined && x.start >= reloadAt).map((x) => (x.start as number) - t0);
      const shownName = (await names(side)).find((e) => e.id === id)?.name ?? null;
      const k = at[side] === undefined ? 'never' : (at[side] as number) <= 4_000 ? 'within 4 s' : 'later';
      const bootWhen = ready.length === 0 ? 'no engine start seen' : ready[0] > 0 ? 'engine ready after the rename' : 'engine ready before the rename';
      const t = (tally[`${label(side)}, ${bootWhen}`] ??= {});
      t[k] = (t[k] ?? 0) + 1;
      row[label(side)] = { shownMs: at[side] ?? null, hostReadyMs: ready, nameAfter: shownName === name ? 'new' : shownName === null ? 'missing' : 'old' };
    }
    out.push(row);
    console.error(JSON.stringify(row));
  }
  console.log(JSON.stringify({ tally, rounds: out }, null, 1));
  await s.context.close();
} finally {
  await closeBrowser();
}
