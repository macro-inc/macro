// Re-evaluate recorded failing aliases without ever emitting their values.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { gatePairs } from './pairs';
import { load } from './run';
import { object } from './scan';

const lines = readFileSync(
  '/home/wolf/tmp/lexical-port/reports/wolf/lexical-corpus-replay-counts.jsonl',
  'utf8'
)
  .trim()
  .split('\n');
const report: unknown = JSON.parse(lines.at(-1) ?? 'null');
if (!object(report) || report.phase !== 'complete' || !object(report.routes))
  throw new Error('Completed replay required');
const aliases = new Set<string>();
for (const value of Object.values(report.routes)) {
  if (!object(value) || !Array.isArray(value.sampleIds))
    throw new Error('Invalid replay report');
  for (const id of value.sampleIds) {
    if (
      typeof id !== 'string' ||
      !/^(?:[0-9a-f]{64}|synthetic-(?:code|list))$/.test(id)
    )
      throw new Error('Invalid replay alias');
    aliases.add(id);
  }
}
const records = load().filter((record) => aliases.has(record.id));
const inventory = readFileSync(
  new URL(
    '../../../../crates/client/lexical/macro_document_model/tests/corpus/nodes.jsonl',
    import.meta.url
  ),
  'utf8'
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
for (const type of ['code', 'list'])
  if (aliases.has(`synthetic-${type}`)) {
    const row = inventory.find(
      (row) => row.type === type && row.profile === 'export'
    );
    records.push({
      id: `synthetic-${type}`,
      state: row.input,
      raw: JSON.stringify(row.input),
    });
  }
const knownFields = new Set(['rawContent', 'nodeId', 'content', 'root', '$']);
function fields(value: unknown) {
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    knownFields.add(key);
    if (Array.isArray(child)) child.forEach(fields);
    else fields(child);
  }
}
for (const row of inventory) fields(row.input);

function classify(
  expected: unknown,
  actual: unknown,
  counts: Record<string, number>
) {
  if (isDeepStrictEqual(expected, actual)) return;
  const add = (kind: string) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
  };
  if (typeof expected === 'string' && typeof actual === 'string') {
    try {
      const left: unknown = JSON.parse(expected);
      const right: unknown = JSON.parse(actual);
      if (isDeepStrictEqual(left, right)) {
        add('json-property-order');
        return;
      }
      if (object(left) && object(right)) {
        classify(left, right, counts);
        return;
      }
    } catch {
      /* Plain text is not JSON. */
    }
    add('string-value');
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) add('array-length');
    for (let i = 0; i < Math.min(expected.length, actual.length); i++)
      classify(expected[i], actual[i], counts);
    return;
  }
  if (object(expected) && object(actual)) {
    for (const key of new Set([
      ...Object.keys(expected),
      ...Object.keys(actual),
    ])) {
      if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key))
        add(
          `field-presence:${Object.hasOwn(expected, key) ? 'ts-only' : 'rust-only'}:${knownFields.has(key) ? key : 'other'}`
        );
      else classify(expected[key], actual[key], counts);
    }
    return;
  }
  add(typeof expected === typeof actual ? 'scalar-value' : 'value-type');
}

const { oracle } = await import('./oracle');
const wasm: { corpus_route(route: string, input: string): string } =
  createRequire(import.meta.url)('../../pkg/node/lexical_conformance_wasm.js');
const result: Record<
  string,
  {
    different: number;
    verdictDifferent: number;
    normalizedDifferent: number;
    reasons: Record<string, number>;
  }
> = {};
try {
  for (const record of records) {
    for (const route of [
      'search',
      'cognition',
      'json-roundtrip',
      'comment-only-change',
    ]) {
      const inputs =
        route === 'comment-only-change'
          ? gatePairs(record.state).map((pair) => ({
              before: record.state,
              after: pair.after,
            }))
          : [{ state: record.state }];
      for (const input of inputs) {
        const ts: unknown = await oracle(route, input);
        const rust: unknown = JSON.parse(
          wasm.corpus_route(route, JSON.stringify(input))
        );
        if (
          !object(ts) ||
          !object(rust) ||
          !Object.hasOwn(ts, 'ok') ||
          !Object.hasOwn(rust, 'ok')
        )
          throw new Error('Unexpected diagnostic conversion failure');
        if (isDeepStrictEqual(ts.ok, rust.ok)) continue;
        result[route] ??= {
          different: 0,
          verdictDifferent: 0,
          normalizedDifferent: 0,
          reasons: {},
        };
        const counts = result[route];
        counts.different++;
        classify(ts.ok, rust.ok, counts.reasons);
        if (
          route === 'comment-only-change' &&
          object(ts.ok) &&
          object(rust.ok)
        ) {
          if (ts.ok.commentOnly !== rust.ok.commentOnly)
            counts.verdictDifferent++;
          if (
            !isDeepStrictEqual(ts.ok.before, rust.ok.before) ||
            !isDeepStrictEqual(ts.ok.after, rust.ok.after)
          )
            counts.normalizedDifferent++;
        }
      }
    }
  }
  process.stdout.write(
    JSON.stringify({ documents: records.length, routes: result }) + '\n'
  );
} catch {
  process.stderr.write('Corpus diagnosis failed; diagnostics suppressed.\n');
  process.exitCode = 2;
}
