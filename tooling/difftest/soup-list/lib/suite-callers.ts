/**
 * The former callers of `useSoupItemsQuery` / `getSoupItems`, mounted at the
 * same moment on main (old) and on the branch (new) for one user, compared at
 * two levels: every field of the rows they read (data), and what the caller
 * renders or acts on (caller). A data difference passes only through a named
 * rule, and only while the caller-level comparison of the same snapshot is
 * exact.
 *
 * Slash-menu PRs changed on purpose: main's menu asked without
 * showSupportedForeignEntities and showed no PRs. The branch is compared with
 * main's query plus that one option (the oracle), and main's own menu is
 * recorded as empty while the oracle is not.
 */
import type { UserSession } from './browser';
import { CALLERS, exportView, parseTimes } from './callers';
import { compareCaller, compareData, DATA_RULES, type Diff, PREVIEW_DROPS_NOTIFICATIONS } from './compare';
import { mount, oneShot, resetQueries, settle, unmount } from './probe';
import type { Coverage, Rng } from './rng';
import type { Ent, UserKey, World } from './world';

export type CallerFailure = {
  user: UserKey;
  caller: string;
  params: unknown;
  level: 'data' | 'caller' | 'status' | 'timeout' | 'harness';
  detail: string;
  diffs?: Diff[];
};

export type CallerResult = {
  cases: number;
  byCaller: Record<string, { cases: number; rows: number; dataRuleHits: Record<string, number> }>;
  failures: CallerFailure[];
  slash: { user: UserKey; oracle: number; branch: number; mainMenu: number }[];
  /** Quick Access before main's cache holds the branch's reads (the known, visible difference). */
  quickAccessRaw: { user: UserKey; buckets: string[]; old: number; new: number; onlyNew: number; onlyOld: number; equal: boolean }[];
  replayedReads: number;
};

export function emptyCallerResult(): CallerResult {
  return { cases: 0, byCaller: {}, failures: [], slash: [], quickAccessRaw: [], replayedReads: 0 };
}

/** Readers that set QUICK_ACCESS_FEED_OPTIONS (ignoresNotifications) on the branch. */
const PREVIEW_READERS = new Set(['qa.agentSessions', 'qa.initiatives', 'qa.skills', 'qa.snippets', 'crm.suggestions', 'slash.prs', 'email.recent']);

const SETTLE = { timeoutMs: 40_000, stableMs: 600 };

type Mount = { caller: string; params: unknown; oldCaller?: string };

const len = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

function record(result: CallerResult, caller: string, rows: number, hits: Record<string, number>) {
  const entry = (result.byCaller[caller] ??= { cases: 0, rows: 0, dataRuleHits: {} });
  entry.cases++;
  entry.rows += rows;
  for (const [id, n] of Object.entries(hits)) entry.dataRuleHits[id] = (entry.dataRuleHits[id] ?? 0) + n;
  result.cases++;
}

/** Mounts a batch on both sides at once, settles, compares, unmounts. */
async function runBatch(session: UserSession, user: UserKey, batch: Mount[], result: CallerResult, coverage: Coverage) {
  const keys = batch.map((_, i) => `c${i}${Math.random().toString(36).slice(2, 7)}`);
  await Promise.all(
    batch.flatMap((m, i) => [
      mount(session.pages.old, keys[i], m.oldCaller ?? m.caller, m.params),
      mount(session.pages.new, keys[i], m.caller, m.params),
    ])
  );
  const settled = await Promise.all(
    batch.map((_, i) => Promise.all([settle(session.pages.old, keys[i], SETTLE), settle(session.pages.new, keys[i], SETTLE)]))
  );
  await Promise.all(keys.flatMap((k) => [unmount(session.pages.old, k), unmount(session.pages.new, k)]));
  batch.forEach((m, i) => {
    const [o, n] = settled[i];
    const fail = (level: CallerFailure['level'], detail: string, diffs?: Diff[]) =>
      result.failures.push({ user, caller: m.caller, params: m.params, level, detail, ...(diffs && { diffs }) });
    if (o.timedOut || n.timedOut) return fail('timeout', `old ${o.timedOut} new ${n.timedOut}`);
    const oErr = (o.status as Record<string, unknown> | undefined)?.error ?? null;
    const nErr = (n.status as Record<string, unknown> | undefined)?.error ?? null;
    if (Boolean(oErr) !== Boolean(nErr)) fail('status', `error old ${oErr} new ${nErr}`);
    const rules = PREVIEW_READERS.has(m.caller) ? [...DATA_RULES, PREVIEW_DROPS_NOTIFICATIONS] : DATA_RULES;
    if (oErr && nErr) coverage.hit('caller-both-error', m.caller);
    const data =
      m.caller === 'quickAccess' || (oErr && nErr) ? { equal: true, diffs: [], ruleHits: {} } : compareData(o.data, n.data, rules);
    if (!data.equal) fail('data', `${data.diffs.length} data diffs`, data.diffs);
    const spec = CALLERS[m.caller];
    const view = compareCaller(spec.project(o.caller), spec.project(n.caller));
    if (!view.equal) fail('caller', `${view.diffs.length} caller diffs`, view.diffs);
    const rows = len(n.caller);
    coverage.hit('caller', m.caller);
    coverage.hit('caller-size', `${m.caller}:${rows === 0 ? 'empty' : rows === 1 ? '1' : rows < 100 ? 'some' : rows < 500 ? '100+' : '500+'}`);
    record(result, m.caller, rows, data.ruleHits);
  });
}

const BUCKET_SETS = [
  [],
  ['agent_session'],
  ['initiative'],
  ['skill'],
  ['snippet'],
  ['crm_company'],
  ['document', 'task', 'snippet', 'skill'],
  ['agent_session', 'initiative', 'skill', 'snippet', 'crm_company'],
];

/**
 * Replays on main's page every Soup GraphQL read the branch's page has sent,
 * through main's own GraphQL client, so main's normalized cache (and the
 * Quick Access history built on it) holds the same rows.
 */
async function replayBranchReads(session: UserSession): Promise<number> {
  const bodies = [...new Set(session.requests.new.filter((q) => q.kind === 'graphql' && q.body && /^(Soup|SoupPreviewPage)$/.test(q.op ?? '')).map((q) => q.body as string))];
  const done = session.replayed ?? new Set<string>();
  session.replayed = done;
  const fresh = bodies.filter((body) => !done.has(body));
  for (const body of fresh) done.add(body);
  if (!fresh.length) return 0;
  await session.pages.old.evaluate(async (list) => {
    const { getGraphqlSoupClient } = await import('/src/lib/service-clients/service-storage/graphql-soup.ts' as string);
    const client = getGraphqlSoupClient();
    for (const raw of list) {
      const { query, variables } = JSON.parse(raw);
      await client.query(query, variables, { requestPolicy: 'network-only' }).toPromise();
    }
  }, fresh);
  await Bun.sleep(1000);
  return fresh.length;
}

/** One user's whole caller matrix on the current world state. */
export async function runCallerLane(args: {
  session: UserSession;
  user: UserKey;
  world: World;
  rng: Rng;
  coverage: Coverage;
  result: CallerResult;
  /** How many hover / similar-task variants to read. */
  variants: number;
  log: (line: string) => void;
}) {
  const { session, user, world, rng, coverage, result } = args;
  await Promise.all([resetQueries(session.pages.old), resetQueries(session.pages.new)]);
  const docs = world.entities.filter((e) => ['md', 'task', 'snippet', 'skill'].includes(e.kind));
  const figDoc = rng.pick(docs);
  const statics: Mount[] = [
    { caller: 'qa.agentSessions', params: {} },
    { caller: 'qa.initiatives', params: {} },
    { caller: 'qa.skills', params: {} },
    { caller: 'qa.snippets', params: {} },
    { caller: 'crm.suggestions', params: {} },
    { caller: 'home.recentChats', params: { limit: 3 } },
    { caller: 'home.recentChats', params: { limit: 12 } },
    { caller: 'recentlyViewed', params: {} },
    { caller: 'fig.libraries', params: { documentId: figDoc.id } },
    { caller: 'email.recent', params: { term: '' } },
    { caller: 'email.recent', params: { term: 'a' } },
  ];
  await runBatch(session, user, statics, result, coverage);
  // Quick access lists history from the GraphQL cache (history/graphql.ts:278),
  // so every row the branch's moved readers fetch over GraphQL joins it. Read
  // it as is first (the visible difference, recorded), then replay the branch's
  // Soup reads on main's page, so both caches hold the same rows, and compare
  // exactly: what remains would be a difference of its own.
  for (const buckets of BUCKET_SETS) {
    const k = `qr${Math.random().toString(36).slice(2, 7)}`;
    await Promise.all([mount(session.pages.old, k, 'quickAccess', { buckets }), mount(session.pages.new, k, 'quickAccess', { buckets })]);
    const [o, n] = await Promise.all([settle(session.pages.old, k, SETTLE), settle(session.pages.new, k, SETTLE)]);
    await Promise.all([unmount(session.pages.old, k), unmount(session.pages.new, k)]);
    const ids = (c: unknown) => (Array.isArray(c) ? c.map((i: { id?: string }) => i.id ?? '') : []);
    const [oi, ni] = [ids(o.caller), ids(n.caller)];
    result.quickAccessRaw.push({
      user,
      buckets,
      old: oi.length,
      new: ni.length,
      onlyNew: ni.filter((id) => !oi.includes(id)).length,
      onlyOld: oi.filter((id) => !ni.includes(id)).length,
      equal: JSON.stringify(oi) === JSON.stringify(ni),
    });
  }
  result.replayedReads += await replayBranchReads(session);
  for (let i = 0; i < BUCKET_SETS.length; i += 2)
    await runBatch(session, user, BUCKET_SETS.slice(i, i + 2).map((buckets) => ({ caller: 'quickAccess', params: { buckets } })), result, coverage);

  // Slash-menu PRs: branch vs oracle (data and caller), and main's own menu.
  await runBatch(session, user, [{ caller: 'slash.prs', oldCaller: 'slash.prsOracle', params: {} }], result, coverage);
  const k = `sl${Math.random().toString(36).slice(2, 7)}`;
  await Promise.all([mount(session.pages.old, k, 'slash.prs', {}), mount(session.pages.old, `${k}o`, 'slash.prsOracle', {}), mount(session.pages.new, k, 'slash.prs', {})]);
  const [mainMenu, oracle, branch] = await Promise.all([settle(session.pages.old, k, SETTLE), settle(session.pages.old, `${k}o`, SETTLE), settle(session.pages.new, k, SETTLE)]);
  await Promise.all([unmount(session.pages.old, k), unmount(session.pages.old, `${k}o`), unmount(session.pages.new, k)]);
  result.slash.push({ user, oracle: len(oracle.caller), branch: len(branch.caller), mainMenu: len(mainMenu.caller) });
  if (len(mainMenu.caller) !== 0)
    result.failures.push({ user, caller: 'slash.prs', params: {}, level: 'caller', detail: `main's menu showed ${len(mainMenu.caller)} PRs; the deliberate change assumes none` });

  // Hover cards over documents of every owner and access, deleted included.
  const hoverDocs = rng.sample(docs, Math.min(args.variants, docs.length));
  for (const d of hoverDocs) coverage.hit('hover-doc', `${d.kind}:${d.owner === user ? 'own' : 'other'}:${d.access}`);
  for (let i = 0; i < hoverDocs.length; i += 8)
    await runBatch(session, user, hoverDocs.slice(i, i + 8).map((d) => ({ caller: 'hover', params: { documentId: d.id } })), result, coverage);

  // Similar-task lists: id sets of every size, mixing visible and hidden tasks.
  const tasks = world.entities.filter((e) => e.kind === 'task');
  const sets: string[][] = [[]];
  for (let i = 0; i < Math.ceil(args.variants / 2); i++) sets.push(rng.sample(tasks, rng.int(1, Math.min(12, tasks.length))).map((t) => t.id));
  for (let i = 0; i < sets.length; i += 6)
    await runBatch(session, user, sets.slice(i, i + 6).map((ids) => ({ caller: 'taskDup', params: { ids } })), result, coverage);
  args.log(`callers ${user}: ${result.cases} cases, ${result.failures.length} failures`);
}

/** One-shot readers (no query cache): CRM export, initiative previews, PR links. */
export async function runOneShots(args: { session: UserSession; user: UserKey; world: World; rng: Rng; coverage: Coverage; result: CallerResult }) {
  const { session, user, world, rng, coverage, result } = args;
  const initiatives = world.entities.filter((e) => e.kind === 'initiative');
  const prs = world.entities.filter((e) => e.kind === 'pr');
  const shots: { name: string; params: unknown; view: (v: unknown) => unknown }[] = [
    { name: 'crm.export', params: {}, view: exportView },
    ...[1, 5, 40].map((n) => ({
      name: 'preview.initiatives',
      params: { ids: [...rng.sample(initiatives, Math.min(n, initiatives.length)).map((e: Ent) => e.id), crypto.randomUUID()] },
      view: parseTimes,
    })),
    ...[1, 10, 120].map((n) => ({
      name: 'prLinks',
      params: {
        targets: rng.sample(prs, Math.min(n, prs.length)).map((p: Ent) => ({ url: `https://github.com/${p.id}`, githubKey: p.id, labels: [] })),
      },
      view: parseTimes,
    })),
  ];
  for (const shot of shots) {
    const [o, n] = (await Promise.all([oneShot(session.pages.old, shot.name, shot.params), oneShot(session.pages.new, shot.name, shot.params)])) as {
      ok: boolean;
      value?: unknown;
      error?: string;
    }[];
    const fail = (level: CallerFailure['level'], detail: string, diffs?: Diff[]) =>
      result.failures.push({ user, caller: shot.name, params: shot.params, level, detail, ...(diffs && { diffs }) });
    if (o.ok !== n.ok) {
      fail('status', `old ${o.ok ? 'ok' : o.error} new ${n.ok ? 'ok' : n.error}`);
      continue;
    }
    const data = compareData(o.value, n.value, DATA_RULES);
    if (!data.equal) fail('data', `${data.diffs.length} data diffs`, data.diffs);
    const view = compareCaller(shot.view(o.value), shot.view(n.value));
    if (!view.equal) fail('caller', `${view.diffs.length} caller diffs`, view.diffs);
    coverage.hit('one-shot', shot.name);
    const v = n.value as { companies?: unknown[]; links?: Record<string, { tasks: unknown[]; sessions: unknown[] }> } | undefined;
    const rows = v?.links
      ? Object.values(v.links).reduce((sum, l) => sum + l.tasks.length + l.sessions.length, 0)
      : len(v?.companies ?? n.value);
    record(result, shot.name, rows, data.ruleHits);
  }
}
