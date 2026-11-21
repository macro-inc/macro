/**
 * Repro (bun run repro/session-rename.ts [rounds]): renames agent sessions in
 * the app and times when each side's Quick Access sessions list shows the new
 * name, renaming on main only, on the branch only, and on both at once. Also
 * prints, per side, the durations of the app's own `agent_session.*` spans
 * (the list refresh pass, its REST refetch phase and the primary row read),
 * so a late list can be put on a phase. Fresh synthetic user; needs run.sh's
 * two Vites.
 */
import { ApiUser } from '../lib/api';
import { closeBrowser, launch, openUser, type Side } from '../lib/browser';
import { mount, settle } from '../lib/probe';
const rounds = Number(process.argv[2] ?? 5);
const tag = Date.now().toString(36);
const email = `owner@wrepro-${tag}.difftest.dev`;
const owner = await new ApiUser('https://localhost:23209', email).login();
const ids: string[] = [];
for (let i = 0; i < 4; i++) {
  const { session } = await owner.post<{ session: { id: string } }>('/agent-harness/agent-sessions', {});
  ids.push(session.id);
}
const sides: Side[] = ['old', 'new'];
const label = (side: Side) => (side === 'old' ? 'main' : 'branch');
type Span = { name: string; ms: number; start: number; attrs: Record<string, unknown> };
const spans: Record<Side, Span[]> = { old: [], new: [] };
const b = await launch();
try {
  const s = await openUser(b, { new: 'http://localhost:23250', old: 'http://localhost:23251' }, email,
    { new: '/src/difftest-probe/new.tsx', old: '/src/difftest-probe/old.tsx' }, owner.browserCookies());
  for (const side of sides)
    s.pages[side].on('request', (request) => {
      if (!request.url().includes('/otlp/v1/traces')) return;
      try {
        for (const rs of JSON.parse(request.postData() ?? '{}').resourceSpans ?? [])
          for (const ss of rs.scopeSpans ?? [])
            for (const span of ss.spans ?? [])
              if (String(span.name).startsWith('agent_session.'))
                spans[side].push({
                  name: span.name,
                  start: Number(BigInt(span.startTimeUnixNano) / 1_000_000n),
                  ms: Number((BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1_000_000n),
                  attrs: Object.fromEntries((span.attributes ?? []).filter((a: any) => /attempt|count|hydrated/.test(a.key)).map((a: any) => [a.key, Object.values(a.value)[0]])),
                });
      } catch {}
    });
  for (const side of sides) await mount(s.pages[side], 'qa', 'qa.agentSessions', {});
  for (const side of sides) await settle(s.pages[side], 'qa', { timeoutMs: 60_000 });
  const shows = async (side: Side, id: string, name: string) => {
    const snap = await settle(s.pages[side], 'qa', { timeoutMs: 500, stableMs: 0 });
    return ((snap.caller ?? []) as { id: string; name?: string }[]).some((e) => e.id === id && e.name === name);
  };
  const rows: unknown[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const mode of ['old', 'new', 'both'] as const) {
      const id = ids[(r * 3 + ['old', 'new', 'both'].indexOf(mode)) % ids.length];
      const name = `Session ${mode} ${r} ${tag}`;
      const writers: Side[] = mode === 'both' ? sides : [mode];
      const t0 = Date.now();
      const results = await Promise.all(writers.map((side) =>
        s.pages[side].evaluate(async (p) => {
          try { await (window as any).__probe.write('renameSession', p); return 'ok'; } catch (e) { return String(e).slice(0, 120); }
        }, { id, name })));
      const wroteMs = Date.now() - t0;
      const seenAt: Partial<Record<Side, number>> = {};
      while (Date.now() - t0 < 30_000 && sides.some((side) => seenAt[side] == null)) {
        for (const side of sides) if (seenAt[side] == null && (await shows(side, id, name))) seenAt[side] = Date.now() - t0;
        await Bun.sleep(100);
      }
      // Let the spans of this round export.
      await Promise.all(sides.map((side) => s.pages[side].evaluate(() => (window as any).__probe.flushTelemetry?.()).catch(() => {})));
      await Bun.sleep(1_500);
      const phases = Object.fromEntries(sides.map((side) => [label(side),
        spans[side].filter((x) => x.start >= t0 - 50).map((x) => `${x.name.replace('agent_session.', '')} +${x.start - t0}ms ${x.ms}ms ${JSON.stringify(x.attrs)}`)]));
      rows.push({ round: r, mode: mode === 'both' ? 'both' : label(mode), writes: results.join('/'), wroteMs, mainMs: seenAt.old ?? null, branchMs: seenAt.new ?? null, phases });
    }
  }
  console.log(JSON.stringify(rows, null, 1));
  await s.context.close();
} finally {
  await closeBrowser();
}
