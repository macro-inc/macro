/**
 * Repro (bun run repro/replay-rows.ts <email> <case.json> [runs]): one fuzz
 * case's generic list on main's app and the branch's, signed in as an existing
 * synthetic user, run after run with the limit lowered by one each time so no
 * run reuses the last one's cached result. Prints each side's row count, error
 * and transport per run. Needs run.sh's two Vites.
 */
import { closeBrowser, launch, openUser } from '../lib/browser';
import { mount, settle, unmount } from '../lib/probe';
const [email, paramsPath, n] = process.argv.slice(2);
const params = JSON.parse(await Bun.file(paramsPath).text());
const b = await launch();
try {
  const s = await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email, { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' });
  for (let i = 0; i < Number(n ?? 5); i++) {
    const key = 'rr' + i;
    // A different page count each run keeps react-query from reusing the last result.
    const p = { ...params, args: { ...params.args, params: { ...params.args.params, limit: params.args.params.limit - i } } };
    await Promise.all((['old', 'new'] as const).map((side) => mount(s.pages[side], key, 'ast', p)));
    const [o, nn] = await Promise.all((['old', 'new'] as const).map((side) => settle(s.pages[side], key, { timeoutMs: 60_000 })));
    const rows = (x: any) => x.data?.entities?.length ?? null;
    console.log('run', i, 'limit', p.args.params.limit, 'main', rows(o), (o.status as any)?.error ?? 'ok', '| branch', rows(nn), (nn.status as any)?.error ?? 'ok', (nn.status as any)?.transport);
    await Promise.all((['old', 'new'] as const).map((side) => unmount(s.pages[side], key)));
  }
  await s.context.close();
} finally { await closeBrowser(); }
