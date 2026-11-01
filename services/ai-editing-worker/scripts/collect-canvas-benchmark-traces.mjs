/** Safe Tempo projection: never writes arbitrary attributes, prompts, media or auth. */
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    'Usage: node collect-canvas-benchmark-traces.mjs <matrix.json> <safe-output.json>'
  );
const tempo = process.env.CANVAS_BENCH_TEMPO_URL ?? 'http://localhost:3200';
const matrix = JSON.parse(await readFile(input, 'utf8'));
const projection = { mode: matrix.mode, results: [] };
const allowed = new Set([
  'gen_ai.response.model',
  'gen_ai.request.model',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_creation.input_tokens',
  'canvas.browser.warm',
  'canvas.browser.heap_bytes',
  'canvas.cache.hit',
  'canvas.schedule.wait_ms',
  'edit.action',
]);
const value = (item) =>
  item?.stringValue ??
  item?.boolValue ??
  (item?.intValue !== undefined ? Number(item.intValue) : item?.doubleValue);
async function get(path) {
  const response = await fetch(`${tempo}${path}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Tempo HTTP ${response.status}`);
  return response.json();
}
function unionMs(intervals) {
  const sorted = intervals.sort((a, b) => a[0] - b[0]);
  let total = 0,
    left,
    right;
  for (const [start, end] of sorted) {
    if (left === undefined) {
      left = start;
      right = end;
    } else if (start <= right) right = Math.max(right, end);
    else {
      total += right - left;
      left = start;
      right = end;
    }
  }
  return total + (left === undefined ? 0 : right - left);
}
for (const result of matrix.results) {
  const query = result.sessionId
    ? `{span.agent.session.id="${result.sessionId}"}`
    : `{span.document.id="${result.documentId}" && span.edit.action="apply"}`;
  const deadline = Date.now() + 60_000;
  let traces = [];
  for (;;) {
    traces =
      (
        await get(
          `/api/search?${new URLSearchParams({ q: query, limit: '20' })}`
        )
      ).traces ?? [];
    if (traces.length || Date.now() > deadline) break;
    await delay(1000);
  }
  const spans = new Map();
  for (const trace of traces) {
    const data = await get(`/api/traces/${trace.traceID}`);
    for (const batch of data.batches ?? data.resourceSpans ?? []) {
      const service = value(
        batch.resource?.attributes?.find((item) => item.key === 'service.name')
          ?.value
      );
      for (const scope of batch.scopeSpans ?? [])
        for (const span of scope.spans ?? []) {
          if (
            !/^(canvas\.|chat|execute_tool|invoke_agent|doc\.sync)/.test(
              span.name
            )
          )
            continue;
          const attributes = Object.fromEntries(
            (span.attributes ?? [])
              .filter((item) => allowed.has(item.key))
              .map((item) => [item.key, value(item.value)])
          );
          const start = Number(BigInt(span.startTimeUnixNano) / 1000n) / 1000;
          const end = Number(BigInt(span.endTimeUnixNano) / 1000n) / 1000;
          spans.set(span.spanId, {
            traceId: trace.traceID,
            service,
            name: span.name,
            start,
            end,
            ms: end - start,
            attributes,
          });
        }
    }
  }
  const rows = [...spans.values()];
  const models = rows.filter(
    (span) =>
      (span.name.startsWith('chat') || span.name === 'canvas.ai.model_usage') &&
      span.attributes['gen_ai.response.model']
  );
  const modelTotals = {};
  for (const span of models) {
    const id = span.attributes['gen_ai.response.model'];
    const totals = modelTotals[id] ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
    totals.calls++;
    totals.inputTokens += Number(
      span.attributes['gen_ai.usage.input_tokens'] ?? 0
    );
    totals.outputTokens += Number(
      span.attributes['gen_ai.usage.output_tokens'] ?? 0
    );
    totals.cacheReadInputTokens += Number(
      span.attributes['gen_ai.usage.cache_read.input_tokens'] ?? 0
    );
    totals.cacheCreationInputTokens += Number(
      span.attributes['gen_ai.usage.cache_creation.input_tokens'] ?? 0
    );
    modelTotals[id] = totals;
  }
  const outerModelSpans = models.filter(
    (span) => span.name !== 'canvas.ai.model_usage'
  );
  const outerTools = rows.filter((span) =>
    span.name.startsWith('execute_tool ')
  );
  const outerModelWallMs = unionMs(
    outerModelSpans.map((span) => [span.start, span.end])
  );
  const outerToolWallMs = unionMs(
    outerTools.map((span) => [span.start, span.end])
  );
  const covered = unionMs(
    [...outerModelSpans, ...outerTools].map((span) => [span.start, span.end])
  );
  const record = {
    case: result.case,
    temperature: result.temperature,
    documentId: result.documentId,
    sessionId: result.sessionId,
    traceIds: traces.map((trace) => trace.traceID),
    totalMs: result.totalMs,
    browser: result.browser,
    modelCalls: models.length,
    modelTotals,
    outerModelWallMs,
    outerToolWallMs,
    outsideRecordedModelAndToolSpansMs: result.sessionId
      ? Math.max(0, result.totalMs - covered)
      : undefined,
    // Tool timings come from spans. Durable log row timestamps may be assigned
    // together during batching/replay and must not be treated as a stopwatch.
    tools: outerTools.map(({ name, ms }) => ({ name, ms })),
    stages: rows
      .filter((span) => span.name.startsWith('canvas.'))
      .map(({ name, ms, attributes }) => ({ name, ms, attributes })),
    invariants: {
      unrelatedPreserved: result.unrelatedPreserved,
      textOverflow: result.textOverflow,
      verifiedRevision: result.verifiedRevision,
    },
  };
  if (!traces.length)
    record.limitation =
      'No indexed trace found within 60 seconds; not evidence of zero model calls.';
  projection.results.push(record);
  await writeFile(output, JSON.stringify(projection, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      case: record.case,
      temperature: record.temperature,
      traces: traces.length,
      modelCalls: record.modelCalls,
      outerModelWallMs,
      outerToolWallMs,
    })
  );
}
