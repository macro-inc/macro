// Reading a draft's trace back from Tempo and splitting its wall time into
// phases: setup, model calls, tool waits, checks and the tail.

import type { Stack } from './stack';

export type Span = {
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
export async function trace(at: Stack, traceId: string): Promise<Span[]> {
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
export async function draftSpans(at: Stack, traceId: string): Promise<{ spans: Span[]; checks: Span[] }> {
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

/**
 * A bare session's spans: its trace, or when the session's turn didn't carry
 * the message's trace context, the traces naming the session in `window`.
 */
export async function sessionSpans(
  at: Stack,
  traceId: string,
  sessionId: string,
  window: { start: number; end: number },
): Promise<Span[]> {
  const chats = (spans: Span[]) => spans.filter((span) => String(span.attrs['gen_ai.operation.name']).startsWith('chat'));
  let spans: Span[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    spans = await trace(at, traceId);
    if (chats(spans).length) return spans;
    await Bun.sleep(2000);
  }
  const search = new URLSearchParams({
    q: `{ span.gen_ai.conversation.id = "${sessionId}" }`,
    start: String(Math.floor(window.start / 1000) - 5),
    end: String(Math.ceil(window.end / 1000) + 60),
    limit: '50',
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = await fetch(`${at.tempo}/api/search?${search}`).catch(() => undefined);
    const { traces = [] } = found?.ok ? ((await found.json()) as { traces?: { traceID: string }[] }) : {};
    const all = [...spans];
    for (const { traceID } of traces) all.push(...(await trace(at, traceID)));
    if (chats(all).length) return all;
    await Bun.sleep(3000);
  }
  return spans;
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

/**
 * Split a draft's server time into phases. `window` replaces the draft span
 * for the bare arm, which has none: the message to the routine existing.
 */
export function breakdown(
  { spans, checks }: { spans: Span[]; checks: Span[] },
  window?: { start: number; end: number },
): Breakdown | undefined {
  const draft = window
    ? { name: 'window', start: window.start, end: window.end, attrs: {} as Span['attrs'] }
    : spans.find((span) => span.name === 'routine.draft');
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
  // Setup ends at the first traced work (a model call, unless that call is
  // missing from the trace); with nothing traced, the whole span is setup.
  const firstBusy = busy.length ? Math.min(...busy.map((span) => span.start)) : draft.end;
  const lastBusy = busy.length ? Math.max(...busy.map((span) => span.end)) : draft.end;
  const serverMs = draft.end - draft.start;
  const setupMs = Math.max(0, firstBusy - draft.start);
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
