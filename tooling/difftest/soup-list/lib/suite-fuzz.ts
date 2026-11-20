/**
 * Translator fuzz. Each generated request is read three ways at once on one
 * user's pages: the branch's reader (new), main's reader (old), and main's
 * reader forced to REST (the oracle). Every case must end in exactly one of:
 *
 * - translatable: the branch read GraphQL, traced no fallback, and returned
 *   REST's rows (data rules allowed, counted);
 * - untranslatable: the branch read REST inside one `soup.rest_fallback` span
 *   per page, with the reason main's translator gives and the expected shape,
 *   and returned exactly REST's rows.
 *
 * Anything else is a failure: an error REST did not have, a silent difference,
 * REST read without a span, a wrong reason or shape.
 */
import { type AstCase, AstGen, expectedReason, expectedShape } from './ast-gen';
import type { UserSession } from './browser';
import { compareData, DATA_RULES, type Diff, PREVIEW_DROPS_NOTIFICATIONS } from './compare';
import { flushTelemetry, mount, settle, translate, unmount } from './probe';
import type { Coverage, Rng } from './rng';
import type { World } from './world';

export type FuzzFailure = {
  kind: string;
  detail: string;
  case: AstCase;
  diffs?: Diff[];
};

export type FuzzResult = {
  cases: number;
  translatable: number;
  fallback: number;
  /** Both sides and REST rejected the request alike (an invalid AST for REST too). */
  restRejected: number;
  failures: FuzzFailure[];
  ruleHits: Record<string, number>;
  reasons: Record<string, number>;
  /** Translatable cases where GraphQL's rows differ from REST's, identically on main. */
  preexisting: FuzzFailure[];
};


const SETTLE = { timeoutMs: 45_000, stableMs: 500 };

async function spansAfter(session: UserSession, from: number) {
  await flushTelemetry(session.pages.new);
  // The route handler receives the export asynchronously.
  let last = -1;
  for (let i = 0; i < 20 && session.spans.new.length !== last; i++) {
    last = session.spans.new.length;
    await Bun.sleep(100);
  }
  return session.spans.new.slice(from);
}

export async function runFuzzLane(args: {
  lane: string;
  session: UserSession;
  world: World;
  rng: Rng;
  coverage: Coverage;
  count: number;
  bases: { label: string; args: AstCase['args'] }[];
  result: FuzzResult;
  log: (line: string) => void;
}) {
  const { session, world, rng, coverage, result, lane } = args;
  const gen = new AstGen(rng, world, coverage);
  for (let i = 0; i < args.count; i++) {
    const c =
      args.bases.length && rng.bool(0.25)
        ? (() => {
            const base = rng.pick(args.bases);
            return gen.mutate(base.args, base.label);
          })()
        : gen.generate();
    coverage.hit('origin', c.origin.split(':')[0]);
    await runCase(session, c, result, coverage).catch((error) => {
      result.failures.push({ kind: 'harness-error', detail: String(error).slice(0, 500), case: c });
    });
    result.cases++;
    if ((i + 1) % 50 === 0) args.log(`fuzz ${lane}: ${i + 1}/${args.count} (${result.failures.length} failures so far)`);
  }
}

async function runCase(session: UserSession, c: AstCase, result: FuzzResult, coverage: Coverage) {
  const { old: oldPage, new: newPage } = session.pages;
  const oldError = (await translate(oldPage, c.args)) as string | null;
  const newVerdict = (await translate(newPage, c.args)) as { reason: string; shape: string } | null;
  const reason = expectedReason(oldError);
  const shape = expectedShape(c.args);
  const fail = (kind: string, detail: string, diffs?: Diff[]) =>
    result.failures.push({ kind, detail, case: c, ...(diffs && { diffs }) });

  if ((newVerdict?.reason ?? null) !== reason)
    fail('translator-verdict', `main says ${JSON.stringify(reason)}, branch says ${JSON.stringify(newVerdict?.reason ?? null)}`);
  if (newVerdict && newVerdict.shape !== shape)
    fail('fallback-shape', `expected ${shape}, branch says ${newVerdict.shape}`);

  const spanFrom = session.spans.new.length;
  const reqFrom = session.requests.new.length;
  const key = `fz${Math.random().toString(36).slice(2, 8)}`;
  const params = { args: c.args, options: c.options, pages: c.pages };
  await Promise.all([
    mount(newPage, key, 'ast', params),
    mount(oldPage, key, 'ast', params),
    mount(oldPage, `${key}r`, 'ast', { ...params, args: { ...c.args, transport: 'rest' } }),
  ]);
  const [n, o, rest] = await Promise.all([
    settle(newPage, key, SETTLE),
    settle(oldPage, key, SETTLE),
    settle(oldPage, `${key}r`, SETTLE),
  ]);
  const spans = (await spansAfter(session, spanFrom)).filter((s) => s.name === 'soup.rest_fallback');
  const requests = session.requests.new.slice(reqFrom);
  await Promise.all([unmount(newPage, key), unmount(oldPage, key), unmount(oldPage, `${key}r`)]);

  if (n.timedOut || o.timedOut || rest.timedOut) {
    fail('timeout', `settle timed out: new ${n.timedOut} old ${o.timedOut} rest ${rest.timedOut}`);
    return;
  }
  const status = n.status as Record<string, unknown>;
  const restError = (rest.status as Record<string, unknown>).error as string | null;
  const newError = status.error as string | null;
  const oldDefaultError = (o.status as Record<string, unknown>).error as string | null;
  if (restError) coverage.hit('rest-error', restError.replace(/[0-9a-f-]{36}/g, '<uuid>').slice(0, 90));

  if (reason === null) {
    result.translatable++;
    coverage.hit('verdict', 'graphql');
    if (status.transport !== 'graphql') fail('transport', `translatable but read ${status.transport}`);
    if (spans.length) fail('untranslatable-span', `translatable but traced ${spans.length} fallback span(s)`);
    if (requests.some((r) => r.kind.startsWith('rest')))
      fail('untraced-rest', `translatable but sent ${requests.map((r) => r.kind).join(',')}`);
    if (newError && !restError) fail('error', `branch failed where REST did not: ${newError}`);
    if (restError) {
      if (newError) {
        result.restRejected++;
        coverage.hit('verdict', 'rejected-by-both');
      }
      return;
    }
  } else {
    result.fallback++;
    result.reasons[reason] = (result.reasons[reason] ?? 0) + 1;
    coverage.hit('verdict', 'fallback');
    coverage.hit('fallback-reason', reason.replace(/[0-9a-f-]{36}/g, '<uuid>').slice(0, 60));
    if (status.transport !== 'rest') fail('transport', `untranslatable but read ${status.transport}`);
    const pagesRead = (status.pages as number) ?? 1;
    const expectedKind = c.args.groupBy ? 'grouped' : 'flat';
    if (!spans.length) fail('untraced-rest', 'fallback read REST without a soup.rest_fallback span');
    else if (spans.length !== pagesRead)
      fail('span-count', `${spans.length} fallback spans for ${pagesRead} page(s)`);
    for (const span of spans) {
      const a = span.attributes;
      if (a['soup.fallback.reason'] !== reason || a['soup.fallback.shape'] !== shape || a['soup.fallback.kind'] !== expectedKind)
        fail('span-attributes', `span ${JSON.stringify(a)}; expected reason ${reason}, shape ${shape}, kind ${expectedKind}`);
      if (a['soup.fallback.cancelled'])
        fail('span-cancelled', `a settled read was traced as cancelled: ${JSON.stringify(spans)} status ${JSON.stringify(status)} rest ${restError}`);
    }
    if (requests.some((r) => r.kind === 'graphql'))
      fail('graphql-on-fallback', `untranslatable but sent GraphQL ${requests.filter((r) => r.kind === 'graphql').map((r) => r.op).join(',')}`);
    if (restError || newError) {
      if (restError !== newError) fail('error', `branch error ${newError} vs REST error ${restError}`);
      else {
        result.restRejected++;
        coverage.hit('verdict', 'rejected-by-both');
      }
      return;
    }
  }

  const rules = c.options.ignoresNotifications ? [...DATA_RULES, PREVIEW_DROPS_NOTIFICATIONS] : DATA_RULES;
  const vsRest = compareData(rest.data, n.data, rules);
  for (const [id, count] of Object.entries(vsRest.ruleHits)) result.ruleHits[id] = (result.ruleHits[id] ?? 0) + count;
  const hasNext = (s: unknown) => (s as Record<string, unknown>).hasNextPage;
  const pageDiff = hasNext(rest.status) !== hasNext(n.status);
  if (!vsRest.equal || pageDiff) {
    // Is it the branch, or the GraphQL path main already uses for this request?
    const mainVsRest = compareData(rest.data, o.data, rules);
    const sameOnMain =
      !oldDefaultError &&
      reason === null &&
      JSON.stringify(compareData(o.data, n.data, rules).diffs) === '[]' &&
      !mainVsRest.equal;
    const detail = pageDiff
      ? `hasNextPage REST ${hasNext(rest.status)} vs branch ${hasNext(n.status)}`
      : `rows differ from REST (${vsRest.diffs.length} diffs)`;
    if (sameOnMain) result.preexisting.push({ kind: 'graphql-vs-rest', detail, case: c, diffs: vsRest.diffs });
    else fail('rows', detail, vsRest.diffs);
  }
  // The branch against main's own reader: a regression check independent of REST.
  const vsMain = compareData(o.data, n.data, rules);
  if (!vsMain.equal && vsRest.equal && !oldDefaultError)
    coverage.hit('note', 'branch matches REST where main did not');
}

export function emptyFuzzResult(): FuzzResult {
  return { cases: 0, translatable: 0, fallback: 0, restRejected: 0, failures: [], ruleHits: {}, reasons: {}, preexisting: [] };
}
