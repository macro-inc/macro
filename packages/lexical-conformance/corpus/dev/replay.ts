import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gatePairs } from './pairs';
import { evaluate } from './results';
import { load, scans } from './run';
import { nodes, object } from './scan';
import { flushTrace, startTrace } from './telemetry';

// Scans always precede loading/evaluating either implementation.
const records = load();
if (!records.length) throw new Error('No dev corpus available');
const trace = await startTrace();
trace.setAttr('corpus.documents', records.length);
const scanSpan = trace.span('lexical.corpus.scan');
const scanCounts = scans();
const devDocuments = records.length;
scanSpan.end();
process.stdout.write(
  JSON.stringify({ phase: 'scans', counts: scanCounts }) + '\n'
);
const masks: unknown = JSON.parse(
  readFileSync(new URL('../normalize.json', import.meta.url), 'utf8')
);
if (!object(masks) || !Array.isArray(masks.masks) || masks.masks.length)
  throw new Error('Unreviewed corpus masks');
// S4 requires legacy code/list coverage even when the bounded sample lacks it.
const sourceInventory = readFileSync(
  new URL(
    '../../../../crates/client/lexical/macro_document_model/tests/corpus/nodes.jsonl',
    import.meta.url
  ),
  'utf8'
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
for (const type of ['code', 'list']) {
  if (scanCounts.histogram[type]?.nodes) continue;
  const row = sourceInventory.find(
    (row) => row.type === type && row.profile === 'export'
  );
  if (!row) throw new Error('Missing legacy synthetic input');
  records.push({
    id: `synthetic-${type}`,
    state: row.input,
    raw: JSON.stringify(row.input),
  });
}
const { oracle, snapshotValue } = await import('./oracle');
const wasm: { corpus_route(route: string, input: string): string } =
  createRequire(import.meta.url)('../../pkg/node/lexical_conformance_wasm.js');
type Counts = {
  compared: number;
  equal: number;
  different: number;
  bothErrorUnverified: number;
  tsError: number;
  rustError: number;
  inputUnavailable: number;
  tsInputChanged: number;
  rustInputChanged: number;
  maskedDocuments: number;
  maskedFields: number;
  sampleIds: string[];
};
const routes: Record<string, Counts> = {};
const gateKinds: Record<string, number> = {};
const strictIdentity = process.argv.includes('--strict-identity');

async function compare(
  route: string,
  input: Record<string, unknown>,
  id: string
) {
  routes[route] ??= {
    compared: 0,
    equal: 0,
    different: 0,
    bothErrorUnverified: 0,
    tsError: 0,
    rustError: 0,
    inputUnavailable: 0,
    tsInputChanged: 0,
    rustInputChanged: 0,
    maskedDocuments: 0,
    maskedFields: 0,
    sampleIds: [],
  };
  const counts = routes[route];
  const span =
    id === records[0]?.id ? trace.span('lexical.corpus.compare') : undefined;
  span?.setAttr('route', route);
  span?.setAttr('document_id', id);
  try {
    const tsSpan = span?.span('lexical.corpus.ts');
    const ts: unknown = await oracle(route, input);
    tsSpan?.end();
    let rust: unknown;
    const rustSpan = span?.span('lexical.corpus.rust');
    try {
      rust = JSON.parse(wasm.corpus_route(route, JSON.stringify(input)));
    } catch {
      rust = { error: 'conversion' };
    } finally {
      rustSpan?.end();
    }
    counts.compared++;
    const result = evaluate(
      ts,
      rust,
      route.startsWith('snapshot/') ? snapshotValue : undefined,
      route.startsWith('snapshot/') && input.markdown === ''
    );
    if (result.kind === 'unverified') counts.bothErrorUnverified++;
    else {
      if (result.tsError) counts.tsError++;
      if (result.rustError) counts.rustError++;
      if (result.kind === 'equal') counts.equal++;
      else {
        counts.different++;
        if (counts.sampleIds.length < 20 && !counts.sampleIds.includes(id))
          counts.sampleIds.push(id);
      }
    }
    if (route === 'json-roundtrip') {
      if (
        object(ts) &&
        'ok' in ts &&
        evaluate({ ok: input.state }, ts).kind !== 'equal'
      )
        counts.tsInputChanged++;
      if (
        object(rust) &&
        'ok' in rust &&
        evaluate({ ok: input.state }, rust).kind !== 'equal'
      )
        counts.rustInputChanged++;
    }
    span?.setAttr('outcome', result.kind);
    return ts;
  } finally {
    span?.end();
  }
}

try {
  for (const record of records) {
    const input = { state: record.state };
    for (const route of [
      'plaintext',
      'search',
      'cognition',
      'cognitionv2',
      'xml',
      'json-roundtrip',
      'snapshot/state',
      'markdown/external',
      'markdown/embedding',
    ])
      await compare(route, input, record.id);
    const internal = await compare('markdown/internal', input, record.id);
    const marks = new Set(
      nodes(record.state)
        .filter((node) => node.type === 'comment-mark')
        .flatMap((node) =>
          Array.isArray(node.ids)
            ? node.ids.filter((id): id is string => typeof id === 'string')
            : []
        )
    );
    for (const markId of marks.size ? marks : ['corpus-missing-mark'])
      await compare('comment-mark', { ...input, markId }, record.id);
    for (const pair of gatePairs(record.state)) {
      gateKinds[pair.kind] = (gateKinds[pair.kind] ?? 0) + 1;
      await compare(
        'comment-only-change',
        { before: record.state, after: pair.after },
        record.id
      );
    }
    if (object(internal) && typeof internal.ok === 'string') {
      const markdown = internal.ok;
      for (const route of ['mentions', 'extract-reply', 'snapshot/markdown'])
        await compare(route, { markdown }, record.id);
      await compare('agent-context', { promptMarkdown: markdown }, record.id);
      await compare(
        'agent-chat-reply',
        { sessionId: 'corpus-session', body: { kind: 'markdown', markdown } },
        record.id
      );
      const chip = nodes(record.state).find(
        (node) => node.type === 'magic-chip'
      ) ?? {
        agentSessionId: 'corpus-session',
        promptedMessage: null,
        status: 'acp_ready',
      };
      const replyTarget = nodes(record.state).find(
        (node) => node.type === 'reply-target'
      );
      await compare(
        'agent-announcement',
        { chip, ...(replyTarget ? { replyTarget } : {}) },
        record.id
      );
      await compare(
        'agent-connection-prompt',
        {
          agentTag: 'corpus',
          message: markdown,
          chip: { appSlug: 'corpus', name: 'Connect', target: 'harness' },
        },
        record.id
      );
    } else {
      for (const route of [
        'mentions',
        'extract-reply',
        'snapshot/markdown',
        'agent-context',
        'agent-chat-reply',
        'agent-announcement',
        'agent-connection-prompt',
      ]) {
        routes[route] ??= {
          compared: 0,
          equal: 0,
          different: 0,
          bothErrorUnverified: 0,
          tsError: 0,
          rustError: 0,
          inputUnavailable: 0,
          tsInputChanged: 0,
          rustInputChanged: 0,
          maskedDocuments: 0,
          maskedFields: 0,
          sampleIds: [],
        };
        routes[route].inputUnavailable++;
      }
    }
    for (const image of nodes(record.state).filter(
      (node) => node.type === 'image'
    )) {
      if (
        typeof image.url === 'string' &&
        typeof image.width === 'number' &&
        typeof image.height === 'number'
      )
        await compare(
          'image-markdown',
          {
            staticFileId:
              typeof image.id === 'string' ? image.id : 'corpus-image',
            url: image.url,
            width: image.width,
            height: image.height,
          },
          record.id
        );
    }
    if (
      Object.values(routes).reduce((sum, count) => sum + count.compared, 0) %
        1000 <
      25
    )
      process.stdout.write(
        JSON.stringify({
          phase: 'progress',
          documents: records.indexOf(record) + 1,
        }) + '\n'
      );
  }
  // Notion is not ordinary Macro markdown: exercise the existing literal Notion
  // source fixtures; the bounded document sample has no Notion source metadata.
  const notions = readFileSync(
    new URL(
      '../../../../crates/client/lexical/macro_document_model/tests/corpus/snapshots.jsonl',
      import.meta.url
    ),
    'utf8'
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((row) => row.kind === 'notion');
  for (const row of notions)
    await compare(
      'snapshot/notion',
      { markdown: row.input, links: row.links },
      'synthetic-notion'
    );
  if (!routes['image-markdown'])
    await compare(
      'image-markdown',
      {
        staticFileId: 'corpus-image',
        url: 'https://example.com/image.png',
        width: 640,
        height: 480,
      },
      'synthetic-image'
    );
  process.stdout.write(
    JSON.stringify({
      phase: 'complete',
      documents: devDocuments,
      syntheticDocuments: records.length - devDocuments,
      routes,
      gateKinds,
      skipped: { htmlNotYetPorted: records.length },
      masks: {},
      identityPolicy: strictIdentity ? 'strict' : 'report-only',
      traceparent: trace.traceparent(),
    }) + '\n'
  );
  if (
    Object.values(routes).some(
      (count) =>
        count.different > 0 ||
        count.bothErrorUnverified > 0 ||
        (strictIdentity &&
          (count.tsInputChanged > 0 || count.rustInputChanged > 0))
    )
  )
    process.exitCode = 1;
} catch {
  process.stderr.write(
    'Corpus replay failed; content and diagnostics suppressed.\n'
  );
  process.exitCode = 2;
} finally {
  trace.end();
  await flushTrace();
}
