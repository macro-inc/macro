/**
 * Repro (bun run repro/qa-people-settle.ts [rounds]): when Quick Access's
 * people rows arrive, against the `isLoading` the probe settles on. The probe's
 * `quickAccess` reader calls itself settled when `createQuickAccessValue()`'s
 * `isLoading()` is false (history and channels only, QuickAccessSource.tsx
 * `isLoading`), while the person rows come from `createPersonList`, which only
 * the list's own `isLoading()` covers. Per round, both sides mount the full
 * list (every bucket) and are sampled every 250 ms for 30 s: the time the
 * probe called them settled, the person rows then, the person rows at the end,
 * whether the two sides' id lists are equal at the end, and the rows only one
 * side lists (bucket, opened or not, name; never a person's). Person ids are
 * counted, never printed. Fresh synthetic user; needs run.sh's two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, openUser, type Side } from '../lib/browser';
import { mount, settle, unmount } from '../lib/probe';
const rounds = Number(process.argv[2] ?? 4);
const tag = Date.now().toString(36);
const email = `empty@wrepro-${tag}.difftest.dev`;
const user = await new ApiUser('https://localhost:23209', email).login();
const probe = { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' };
const sides: Side[] = ['old', 'new'];
const label = (side: Side) => (side === 'old' ? 'main' : 'branch');
type Item = { id?: string; bucket?: string; name?: string; viewedAt?: unknown; timestamps?: { viewedAt?: unknown } };
const b = await launch();
try {
  const s = await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email, probe, user.browserCookies());
  const out: unknown[] = [];
  for (let r = 0; r < rounds; r++) {
    const key = `qp${r}`;
    const t0 = Date.now();
    await Promise.all(sides.map((side) => mount(s.pages[side], key, 'quickAccess', { buckets: [] })));
    const row: Record<string, unknown> = { round: r };
    const settledAt: Partial<Record<Side, number>> = {};
    const atSettle: Partial<Record<Side, number>> = {};
    const lastIds: Partial<Record<Side, string[]>> = {};
    const lastItems: Partial<Record<Side, Item[]>> = {};
    const peopleAt: Record<string, [number, number][]> = { main: [], branch: [] };
    while (Date.now() - t0 < 30_000) {
      for (const side of sides) {
        const snap = await settle(s.pages[side], key, { timeoutMs: 300, stableMs: 0 });
        const items = (snap.caller ?? []) as Item[];
        const people = items.filter((i) => i.bucket === 'person').length;
        if (settledAt[side] === undefined && snap.settled) {
          settledAt[side] = Date.now() - t0;
          atSettle[side] = people;
        }
        const series = peopleAt[label(side)];
        if (series.at(-1)?.[1] !== people) series.push([Date.now() - t0, people]);
        lastIds[side] = items.map((i) => i.id ?? '');
        lastItems[side] = items;
      }
      await Bun.sleep(250);
    }
    for (const side of sides)
      row[label(side)] = {
        settledMs: settledAt[side] ?? null,
        peopleAtSettle: atSettle[side] ?? null,
        peopleAt30s: peopleAt[label(side)].at(-1)?.[1] ?? 0,
        rowsAt30s: lastIds[side]?.length ?? 0,
        peopleOverTime: peopleAt[label(side)],
      };
    // The rows one side lists and the other doesn't: bucket, whether the user
    // ever opened it, and its name (never for people).
    for (const side of sides) {
      const other = new Set(lastIds[side === 'old' ? 'new' : 'old'] ?? []);
      (row[label(side)] as Record<string, unknown>).onlyHere = (lastItems[side] ?? [])
        .filter((i) => !other.has(i.id ?? ''))
        .map((i) => ({ bucket: i.bucket, opened: (i.viewedAt ?? i.timestamps?.viewedAt) != null, name: i.bucket === 'person' ? undefined : i.name }));
    }
    row.equalAt30s = JSON.stringify(lastIds.old) === JSON.stringify(lastIds.new);
    await Promise.all(sides.map((side) => unmount(s.pages[side], key)));
    out.push(row);
    console.error(JSON.stringify(row));
  }
  console.log(JSON.stringify({ rounds: out }, null, 1));
  await s.context.close();
} finally {
  await closeBrowser();
}
