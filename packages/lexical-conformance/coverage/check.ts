import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { directory, replayEvidence, root } from './evidence';
import {
  build,
  covered,
  ledgerReason,
  ledgerReasons,
  seeds,
  testEvidence,
} from './matrix';
import { pendingErrors } from './pending';

const check = process.argv.includes('--check');
const initialize = process.argv.includes('--initialize');
const matrix = build(
  seeds(readFileSync(path.join(directory, 'seed-matrix.tsv'), 'utf8'))
);
const replay = replayEvidence();
const tests = testEvidence();
const pendingFile = path.join(directory, 'pending.txt');
if (initialize && existsSync(pendingFile))
  throw new Error('Pending ratchet already initialized');
if (initialize)
  writeFileSync(
    pendingFile,
    matrix
      .filter((row) => row.gate === 'required')
      .map((row) => row.id)
      .sort()
      .join('\n') + '\n'
  );
const pending = new Set(
  readFileSync(pendingFile, 'utf8').split('\n').filter(Boolean)
);
const ids = new Set(
  matrix.filter((row) => row.gate === 'required').map((row) => row.id)
);
const errors: string[] = [];
const base =
  process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) ??
  process.env.LEXICAL_COVERAGE_BASE ??
  'origin/main';
if (
  spawnSync('git', ['rev-parse', '--verify', base], {
    cwd: root,
    stdio: 'ignore',
  }).status !== 0
)
  throw new Error(`Cannot verify ratchet base: ${base}`);
const prior = spawnSync(
  'git',
  ['show', `${base}:packages/lexical-conformance/coverage/pending.txt`],
  { cwd: root, encoding: 'utf8' }
);
if (
  prior.status !== 0 &&
  !/path .*(?:does not exist|exists on disk, but not in)/.test(prior.stderr)
)
  throw new Error(`Cannot read ratchet baseline: ${prior.stderr}`);
const baseline =
  prior.status === 0 ? new Set(prior.stdout.split('\n')) : undefined;
const ledger = matrix.flatMap((row) => {
  const reason = ledgerReason(row);
  if (!reason) return [];
  if (!ledgerReasons.has(reason))
    errors.push(`Invalid ledger reason: ${row.id} ${reason}`);
  const citation = row.gate.match(/\((S[123478]:\d+)\)/)?.[1] ?? row.source;
  const [document, number] = citation.split(':');
  const names: Record<string, string> = {
    S1: 'S1-api.md',
    S2: 'S2-feature-inventory.md',
    S3: 'S3-packages.md',
    S4: 'S4-tests.md',
    S7: 'S7-session.md',
    S8: 'S8-simulation.md',
  };
  const file = names[document];
  if (
    !file ||
    !readFileSync(
      path.join(root, 'docs/design/lexical-port', file),
      'utf8'
    ).split('\n')[Number(number) - 1]
  )
    errors.push(`Invalid ledger citation: ${row.id} ${citation}`);
  return [{ id: row.id, reason, source: citation }];
});
for (const [name, value] of [
  ['matrix.json', matrix],
  ['ledger.json', ledger],
] as const) {
  const output = JSON.stringify(value, null, 2) + '\n';
  const file = path.join(directory, name);
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== output)
      errors.push(`Stale ${name}: run just lexical-coverage`);
  } else writeFileSync(file, output);
}
let uncovered = 0;
const gaps = new Set<string>();
for (const row of matrix) {
  const green = covered(row, replay, tests);
  if (row.kind === 'sym' && row.pri === 'P0' && !green)
    console.log(`UNCOVERED P0 ${row.id} (${row.gate}; ${row.test_id})`);
  if (row.gate.startsWith('blocked') || row.gate === 'MISSING')
    errors.push(`${row.id}: ${row.gate}`);
  if (row.gate === 'required' && !green) {
    uncovered++;
    gaps.add(row.id);
  }
}
errors.push(...pendingErrors(pending, ids, baseline, gaps));
const milestone = process.argv
  .find((arg) => arg.startsWith('--milestone='))
  ?.slice(12);
if (milestone)
  for (const row of matrix)
    if (row.milestone === milestone && pending.has(row.id))
      errors.push(`Pending ${milestone} row: ${row.id}`);
console.log(
  `${matrix.length} rows; ${uncovered} required rows uncovered; ${pending.size} pending; ${ledger.length} policy ledger entries`
);
console.log(
  replay
    ? 'Rust replay evidence: current complete corpus'
    : 'No current Rust replay evidence; recorded fixtures alone prove no Rust coverage'
);
console.log(
  'Policy ledger entries do not certify Tier B execution; later tier reports remain required.'
);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
