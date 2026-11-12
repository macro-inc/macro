// Routine drafting benchmark. Runs `CASES` against `POST
// /scheduled-actions/drafts` on a local stack, each with its own trace, and
// reads each trace back from Tempo to split the wall time into its phases.
// See README.md.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { CASES, type Case, type DraftResult, FIXTURE } from './cases';

const SCENARIO = JSON.parse(
  readFileSync(join(import.meta.dir, 'scenario.json'), 'utf8'),
) as { scenario: string; users: Record<string, { email: string }> };
const USER = SCENARIO.users.riley.email;
const TIMEZONE = 'America/New_York';

// ---------- setup ----------

type Stack = { auth: string; harness: string; webApp: string; tempo: string };

function stack(instance: string, tempo: string): Stack {
  const root = resolve(import.meta.dir, '../../..');
  const path = join(root, 'infra/local/generated', instance, 'portmap.json');
  if (!existsSync(path)) {
    throw new Error(`no portmap at ${path}; start the stack with \`just run_local --instance ${instance}\``);
  }
  const portmap = JSON.parse(readFileSync(path, 'utf8')) as {
    webAppUrl: string;
    hosts: Record<string, string>;
  };
  return {
    auth: portmap.hosts.auth,
    harness: portmap.hosts.cognition.replace(/\/cognition$/, ''),
    webApp: portmap.webAppUrl,
    tempo,
  };
}

/** A Macro API token for `email`, through local passwordless login. */
async function login(at: Stack, email: string): Promise<string> {
  const started = await fetch(`${at.auth}/login/passwordless`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, redirect_uri: `${at.webApp}/app` }),
  });
  const { code } = (await started.json()) as { code?: string };
  if (!code) throw new Error(`no passwordless code for ${email}; seed the scenario first`);
  const tokens = await fetch(
    `${at.auth}/oauth/passwordless/${code}?email=${encodeURIComponent(email)}&disable_redirect=true`,
  );
  const { access_token } = (await tokens.json()) as { access_token: string };
  const api = await fetch(`${at.auth}/jwt/macro_api_token`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!api.ok) throw new Error(`macro_api_token ${api.status}`);
  return ((await api.json()) as { macro_api_token: string }).macro_api_token;
}

/** The seed CLI's id for a scenario entity (`derive_id` in tooling/seed_cli). */
function seedId(scenario: string, kind: string, key: string): string {
  const bytes = Buffer.alloc(16);
  bytes[0] = 0x5e;
  bytes[1] = 0xed;
  createHash('sha256').update(scenario).digest().copy(bytes, 2, 0, 2);
  createHash('sha256')
    .update(Buffer.concat([Buffer.from(scenario), Buffer.from([0]), Buffer.from(kind), Buffer.from([0]), Buffer.from(key)]))
    .digest()
    .copy(bytes, 4, 0, 12);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const FIXTURE_IDS = Object.fromEntries(
  Object.entries(FIXTURE).map(([name, { kind, key }]) => [name, seedId(SCENARIO.scenario, kind, key)]),
);

type CatalogEntry = { key: string; trigger: unknown; code?: unknown };

async function catalog(at: Stack, token: string): Promise<CatalogEntry[]> {
  const response = await fetch(
    `${at.harness}/scheduled-action/scheduled-actions/catalog?timezone=${encodeURIComponent(TIMEZONE)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`catalog ${response.status}: ${await response.text()}`);
  return (await response.json()) as CatalogEntry[];
}

function requestBody(item: Case, entries: CatalogEntry[], model: string) {
  const context = { timezone: TIMEZONE, agentModel: model, code: item.code, conditions: true };
  if (item.kind === 'routine') return { draft: { type: 'routine', description: item.text }, context };
  const base = entries.find((entry) => entry.key === item.base?.catalogKey);
  if (!base?.code) throw new Error(`catalog routine ${item.base?.catalogKey} with a code step not found`);
  const routine = { trigger: base.trigger, steps: [base.code] };
  if (item.kind === 'add_step') {
    return { draft: { type: 'add_step', description: item.text, routine }, context };
  }
  return { draft: { type: 'change_step', instruction: item.text, routine, index: item.index ?? 0 }, context };
}

// ---------- traces ----------

type Span = {
  name: string;
  start: number;
  end: number;
  attrs: Record<string, string | number | boolean>;
};

type OtlpValue = { stringValue?: string; intValue?: string | number; boolValue?: boolean; doubleValue?: number };

function value(raw: OtlpValue): string | number | boolean {
  if (raw.stringValue !== undefined) return raw.stringValue;
  if (raw.intValue !== undefined) return Number(raw.intValue);
  if (raw.doubleValue !== undefined) return raw.doubleValue;
  if (raw.boolValue !== undefined) return raw.boolValue;
  return JSON.stringify(raw);
}

/**
 * Every span of a trace, or none while Tempo hasn't ingested it or can't
 * answer (it restarts with the shared collector).
 */
async function trace(at: Stack, traceId: string): Promise<Span[]> {
  const response = await fetch(`${at.tempo}/api/traces/${traceId}`).catch(() => undefined);
  if (!response?.ok) return [];
  const body = (await response.json()) as {
    batches?: unknown[];
    resourceSpans?: unknown[];
  };
  const spans: Span[] = [];
  type Batch = { scopeSpans?: { spans: RawSpan[] }[]; instrumentationLibrarySpans?: { spans: RawSpan[] }[] };
  type RawSpan = {
    name: string;
    startTimeUnixNano: string;
    endTimeUnixNano: string;
    attributes?: { key: string; value: OtlpValue }[];
  };
  for (const batch of (body.batches ?? body.resourceSpans ?? []) as Batch[]) {
    for (const scope of batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? []) {
      for (const raw of scope.spans) {
        spans.push({
          name: raw.name,
          start: Number(BigInt(raw.startTimeUnixNano) / 1000n) / 1000,
          end: Number(BigInt(raw.endTimeUnixNano) / 1000n) / 1000,
          attrs: Object.fromEntries((raw.attributes ?? []).map((a) => [a.key, value(a.value)])),
        });
      }
    }
  }
  return spans;
}

/**
 * A draft's spans and its checks. The session's code calls
 * `macro.routines.check` without the draft's trace context, so checks land in
 * traces of their own; with one draft at a time on the stack, every draft
 * check inside the draft's span is its. Tempo indexes a trace for search only
 * once it goes idle, so this waits for as many as the draft span counted.
 */
async function draftSpans(at: Stack, traceId: string): Promise<{ spans: Span[]; checks: Span[] }> {
  let spans: Span[] = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    spans = await trace(at, traceId);
    if (spans.some((span) => span.name === 'routine.draft')) break;
    await Bun.sleep(2000);
  }
  // Late spans (cleanup) land after the response; let Tempo settle once.
  await Bun.sleep(3000);
  spans = await trace(at, traceId);
  const draft = spans.find((span) => span.name === 'routine.draft');
  if (!draft) return { spans, checks: [] };
  const counted = Number(draft.attrs['routine.draft.checks'] ?? 0);
  const search = new URLSearchParams({
    q: '{ name = "routine.check" && span.routine.check.draft = true }',
    start: String(Math.floor(draft.start / 1000) - 1),
    end: String(Math.ceil(draft.end / 1000) + 1),
    limit: '50',
  });
  let checks: Span[] = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    checks = [];
    const found = await fetch(`${at.tempo}/api/search?${search}`).catch(() => undefined);
    const { traces = [] } = found?.ok ? ((await found.json()) as { traces?: { traceID: string }[] }) : {};
    for (const { traceID } of traces) {
      for (const span of await trace(at, traceID)) {
        if (span.name === 'routine.check' && span.start >= draft.start && span.start <= draft.end) {
          checks.push(span);
        }
      }
    }
    if (checks.length >= counted) break;
    await Bun.sleep(2000);
  }
  return { spans, checks: checks.sort((a, b) => a.start - b.start) };
}

type Interval = [number, number];

/** The intervals merged where they overlap, in order. */
function merged(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** Total time covered by some interval. */
const covered = (intervals: Interval[]) =>
  merged(intervals).reduce((total, [from, to]) => total + to - from, 0);

/**
 * A pause between the session's calls longer than this is a model call the
 * trace lost (it happens to long ones), counted as one.
 */
const UNTRACED_CALL_MS = 1000;

export type Breakdown = {
  /** The draft span, from the request reaching the drafter to its answer. */
  serverMs: number;
  /** Draft start to the session's first model call: session setup and admission. */
  setupMs: number;
  /** The session's model calls, end to end, untraced ones included. */
  modelMs: number;
  modelCalls: number;
  /** Of those, calls missing from the trace, timed by the pause they left. */
  untracedCalls: number;
  /** Time to first streamed chunk, per model call. */
  firstChunkMs: number[];
  /** Input tokens per draft, cached ones included. */
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** Per tool: calls and total time (a call starts while its input streams). */
  tools: Record<string, { calls: number; ms: number }>;
  /** Time the session waited on tools with no model call running. */
  toolWaitMs: number;
  checks: number;
  checksPassed: number;
  checkMs: number;
  /** Draft start to the end of its first passing check: when an answer existed. */
  firstPassMs?: number;
  /** The last model or tool call ending to the answer: grace, stop, settle, cleanup. */
  tailMs: number;
  /** Server time in neither setup, model calls, tool waits nor tail: gaps between turns. */
  otherMs: number;
  ended?: string;
  statusReads?: number;
};

function breakdown({ spans, checks }: { spans: Span[]; checks: Span[] }): Breakdown | undefined {
  const draft = spans.find((span) => span.name === 'routine.draft');
  if (!draft) return undefined;
  const inside = (span: Span, outer: Span) => span.start >= outer.start && span.end <= outer.end;
  // The opener's side call runs beside the session's first turn, off its path.
  const openers = spans.filter((span) => span.name === 'agent.opener');
  const chats = spans
    .filter(
      (span) =>
        String(span.attrs['gen_ai.operation.name']).startsWith('chat') &&
        inside(span, draft) &&
        !openers.some((opener) => inside(span, opener)),
    )
    .sort((a, b) => a.start - b.start);
  // The session reports each call once as `execute_tool <name>`; the runner's
  // and toolset's spans for the same call are left out.
  const toolSpans = spans.filter((span) => span.name.startsWith('execute_tool ') && inside(span, draft));
  const tools: Breakdown['tools'] = {};
  for (const span of toolSpans) {
    const name = String(span.attrs['gen_ai.tool.name'] ?? span.name);
    tools[name] ??= { calls: 0, ms: 0 };
    tools[name].calls += 1;
    tools[name].ms += span.end - span.start;
  }
  const interval = (span: Span): Interval => [span.start, span.end];
  const busy = [...chats, ...toolSpans];
  const firstModel = chats[0]?.start ?? draft.end;
  const lastBusy = busy.length ? Math.max(...busy.map((span) => span.end)) : draft.start;
  const serverMs = draft.end - draft.start;
  const setupMs = Math.max(0, firstModel - draft.start);
  const tailMs = Math.max(0, draft.end - lastBusy);
  const toolWaitMs = covered(busy.map(interval)) - covered(chats.map(interval));
  const calls = merged(busy.map(interval));
  const pauses = calls
    .slice(1)
    .map(([from], index) => from - calls[index][1])
    .filter((pause) => pause > UNTRACED_CALL_MS);
  const modelMs =
    chats.reduce((sum, span) => sum + span.end - span.start, 0) + pauses.reduce((sum, pause) => sum + pause, 0);
  const number = (span: Span, key: string) => Number(span.attrs[key] ?? 0);
  const sum = (key: string) => chats.reduce((total, span) => total + number(span, key), 0);
  const cachedTokens = sum('gen_ai.usage.cache_read.input_tokens');
  const passed = checks.find((span) => span.attrs['routine.check.ok'] === true);
  return {
    serverMs,
    setupMs,
    modelMs,
    modelCalls: chats.length + pauses.length,
    untracedCalls: pauses.length,
    firstChunkMs: chats.map((span) => number(span, 'macro.genai.chat.time_to_first_chunk_ms')),
    inputTokens:
      sum('gen_ai.usage.input_tokens') + cachedTokens + sum('gen_ai.usage.cache_creation.input_tokens'),
    cachedTokens,
    outputTokens: sum('gen_ai.usage.output_tokens'),
    tools,
    toolWaitMs,
    checks: checks.length,
    checksPassed: checks.filter((span) => span.attrs['routine.check.ok'] === true).length,
    checkMs: checks.reduce((total, span) => total + span.end - span.start, 0),
    firstPassMs: passed ? passed.end - draft.start : undefined,
    tailMs,
    otherMs: Math.max(0, serverMs - setupMs - modelMs - toolWaitMs - tailMs),
    ended: draft.attrs['routine.draft.ended'] as string | undefined,
    statusReads: draft.attrs['routine.draft.status_reads'] as number | undefined,
  };
}

// ---------- run ----------

export type Run = {
  case: string;
  run: number;
  traceId: string;
  status: number;
  wallMs: number;
  breakdown?: Breakdown;
  draft?: DraftResult;
  error?: string;
  quality: { says: string; holds: boolean }[];
};

export type Results = {
  label: string;
  model: string;
  startedAt: string;
  commit: string;
  runs: Run[];
};

/** How `draft` fares on what a good draft of `item` does. */
function judge(item: Case, draft: DraftResult) {
  return item.expect.map((expectation) => ({
    says: expectation.says,
    holds: expectation.holds(draft, FIXTURE_IDS),
  }));
}

async function draftOnce(at: Stack, token: string, item: Case, body: unknown, run: number): Promise<Run> {
  const traceId = randomBytes(16).toString('hex');
  const parent = randomBytes(8).toString('hex');
  const started = performance.now();
  const response = await fetch(`${at.harness}/scheduled-action/scheduled-actions/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      traceparent: `00-${traceId}-${parent}-01`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const wallMs = performance.now() - started;
  let draft: DraftResult | undefined;
  try {
    draft = JSON.parse(text) as DraftResult;
  } catch {}
  const quality = draft ? judge(item, draft) : [];
  return {
    case: item.id,
    run,
    traceId,
    status: response.status,
    wallMs,
    draft,
    error: response.ok ? undefined : text.slice(0, 500),
    quality,
  };
}

async function run(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      label: { type: 'string' },
      runs: { type: 'string', default: '3' },
      cases: { type: 'string' },
      model: { type: 'string', default: 'anthropic/claude-sonnet-5-5' },
      instance: { type: 'string', default: 'drafting' },
      tempo: { type: 'string', default: process.env.TEMPO_URL ?? 'http://localhost:3200' },
      out: { type: 'string' },
      append: { type: 'boolean', default: false },
    },
  });
  if (!values.label || !values.out) throw new Error('run needs --label and --out');
  const at = stack(values.instance as string, values.tempo as string);
  const token = await login(at, USER);
  const entries = await catalog(at, token);
  const wanted = values.cases ? new Set(values.cases.split(',')) : undefined;
  const cases = CASES.filter((item) => !wanted || wanted.has(item.id));
  const commit = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD']).stdout.toString().trim();
  const out = resolve(values.out);
  // `--append` adds rounds to an earlier run of the same build.
  const results: Results =
    values.append && existsSync(out)
      ? (JSON.parse(readFileSync(out, 'utf8')) as Results)
      : { label: values.label, model: values.model as string, startedAt: new Date().toISOString(), commit, runs: [] };
  const done = Math.max(0, ...results.runs.map((result) => result.run));
  mkdirSync(dirname(out), { recursive: true });
  // Round-robin over cases, so a slow patch of the model's day spreads across
  // every case instead of landing on one.
  for (let round = done + 1; round <= done + Number(values.runs); round++) {
    for (const item of cases) {
      const body = requestBody(item, entries, values.model as string);
      const result = await draftOnce(at, token, item, body, round);
      result.breakdown = breakdown(await draftSpans(at, result.traceId));
      results.runs.push(result);
      writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
      const b = result.breakdown;
      const passed = result.quality.filter((q) => q.holds).length;
      console.log(
        [
          `${item.id} #${round}`,
          `${(result.wallMs / 1000).toFixed(1)}s`,
          `status ${result.status}`,
          result.draft?.outcome ?? 'no draft',
          b ? `model ${(b.modelMs / 1000).toFixed(1)}s/${b.modelCalls}` : 'no trace',
          b ? `tools ${Object.values(b.tools).reduce((sum, tool) => sum + tool.calls, 0)}` : '',
          b ? `checks ${b.checksPassed}/${b.checks}` : '',
          b ? `tail ${(b.tailMs / 1000).toFixed(1)}s` : '',
          `quality ${passed}/${result.quality.length}`,
        ].join('  '),
      );
    }
  }
  console.log(`wrote ${out}`);
}

/** Read every run's trace and judge its draft again, after either changed. */
async function reread(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      instance: { type: 'string', default: 'drafting' },
      tempo: { type: 'string', default: process.env.TEMPO_URL ?? 'http://localhost:3200' },
      'quality-only': { type: 'boolean', default: false },
    },
  });
  const at = stack(values.instance as string, values.tempo as string);
  for (const path of positionals) {
    const results = JSON.parse(readFileSync(path, 'utf8')) as Results;
    for (const result of results.runs) {
      const item = CASES.find((candidate) => candidate.id === result.case);
      if (item && result.draft) result.quality = judge(item, result.draft);
      if (!values['quality-only']) result.breakdown = breakdown(await draftSpans(at, result.traceId)) ?? result.breakdown;
    }
    writeFileSync(path, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`reread ${results.runs.length} runs in ${path}`);
  }
}

// ---------- compare ----------

const quantile = (values: number[], q: number) => {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
const seconds = (ms: number) => (Number.isNaN(ms) ? '–' : (ms / 1000).toFixed(1));
const spread = (values: number[]) =>
  `${seconds(quantile(values, 0.5))} (${seconds(Math.min(...values))}–${seconds(Math.max(...values))})`;

/** Summary rows for one results file, overall and per case. */
export function summarize(results: Results) {
  const groups = new Map<string, Run[]>();
  for (const result of results.runs) {
    groups.set(result.case, [...(groups.get(result.case) ?? []), result]);
  }
  groups.set('all', results.runs);
  return [...groups].map(([name, runs]) => {
    const with_ = runs.filter((result) => result.breakdown);
    const pick = (f: (b: Breakdown) => number) => with_.map((result) => f(result.breakdown as Breakdown));
    const checks = runs.flatMap((result) => result.quality);
    return {
      case: name,
      runs: runs.length,
      failed: runs.filter((result) => result.draft?.outcome !== 'routine' && result.draft?.outcome !== 'step').length,
      wall: runs.map((result) => result.wallMs),
      setup: pick((b) => b.setupMs),
      model: pick((b) => b.modelMs),
      modelCalls: pick((b) => b.modelCalls),
      toolWait: pick((b) => b.toolWaitMs),
      toolCalls: pick((b) => Object.values(b.tools).reduce((sum, tool) => sum + tool.calls, 0)),
      tail: pick((b) => b.tailMs),
      firstPass: with_.flatMap((result) => result.breakdown?.firstPassMs ?? []),
      other: pick((b) => b.otherMs),
      inputTokens: pick((b) => b.inputTokens),
      outputTokens: pick((b) => b.outputTokens),
      checks: pick((b) => b.checks),
      quality: `${checks.filter((q) => q.holds).length}/${checks.length}`,
    };
  });
}

function compare(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: 'string' } },
  });
  const files = positionals.map((path) => JSON.parse(readFileSync(path, 'utf8')) as Results);
  const lines: string[] = [];
  const median = (values: number[]) => quantile(values, 0.5);
  lines.push('Medians in seconds; wall time also shows (min–max).', '');
  lines.push(
    '| case | build | runs | failed | wall | first pass | setup | model (calls) | tool wait (calls) | tail | other | in tok | out tok | checks | quality |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  const summaries = files.map((file) => ({ label: file.label, rows: summarize(file) }));
  const cases = summaries[0].rows.map((row) => row.case);
  for (const name of [...cases.filter((c) => c !== 'all'), 'all']) {
    for (const { label, rows } of summaries) {
      const row = rows.find((r) => r.case === name);
      if (!row) continue;
      lines.push(
        `| ${name} | ${label} | ${row.runs} | ${row.failed} | ${spread(row.wall)} | ${seconds(median(row.firstPass))} | ${seconds(median(row.setup))} | ${seconds(median(row.model))} (${median(row.modelCalls)}) | ${seconds(median(row.toolWait))} (${median(row.toolCalls)}) | ${seconds(median(row.tail))} | ${seconds(median(row.other))} | ${Math.round(median(row.inputTokens))} | ${Math.round(median(row.outputTokens))} | ${median(row.checks)} | ${row.quality} |`,
      );
    }
  }
  const report = `${lines.join('\n')}\n`;
  if (values.out) writeFileSync(values.out, report);
  console.log(report);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'run') await run(rest);
else if (command === 'compare') compare(rest);
else if (command === 'reread') await reread(rest);
else {
  console.error('usage: drafts.ts run --label <name> --out <file.json> [--runs 3] [--cases a,b] [--model m] [--instance drafting] [--append]');
  console.error('       drafts.ts compare <before.json> <after.json> [--out report.md]');
  console.error('       drafts.ts reread [--quality-only] <results.json>...  (judge the drafts and read the traces again)');
  process.exit(2);
}
