// Remove only rows backed by a fresh passing native replay and retain its witnesses.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readFixtureText } from '../record/files';
import { directory, hash, replayEvidence, root } from './evidence';
import { build, covered, seeds } from './matrix';

const [base, logFile, reportFile] = process.argv.slice(2);
if (!base || !logFile || !reportFile)
  throw new Error('Usage: shrink-pending.ts <base> <replay-log> <report>');
const pendingFile = path.join(directory, 'pending.txt');
const prior = spawnSync(
  'git',
  [
    '-c',
    'maintenance.auto=false',
    '-c',
    'gc.auto=0',
    'show',
    `${base}:packages/lexical-conformance/coverage/pending.txt`,
  ],
  { cwd: root, encoding: 'utf8' }
);
if (prior.status !== 0) throw new Error(prior.stderr || 'Missing baseline');
const baseline = new Set(prior.stdout.split('\n').filter(Boolean));
const pending = readFileSync(pendingFile, 'utf8').split('\n').filter(Boolean);
if (pending.some((id) => !baseline.has(id)))
  throw new Error('Pending ratchet grew');
const replay = replayEvidence();
if (!replay) throw new Error('Run just lexical-replay first');
const log = readFileSync(logFile, 'utf8');
const passed = new Set(
  log.split('\n').flatMap((line) => {
    const match = line.match(/^test (.+?)\s+\.\.\. ok$/);
    return match ? [match[1]] : [];
  })
);
const rows = build(
  seeds(readFileSync(path.join(directory, 'seed-matrix.tsv'), 'utf8'))
);
const green = new Map(
  rows.filter((row) => covered(row, replay, [])).map((row) => [row.id, row])
);
const remaining = pending.filter((id) => !green.has(id));
const removed = [...baseline]
  .filter((id) => !remaining.includes(id))
  .sort()
  .map((id) => {
    const row = green.get(id);
    if (!row)
      throw new Error(`Removed row lacks current native execution: ${id}`);
    const fixture = row.fixtures.find(
      (candidate) => replay.cases[candidate.file]?.status === 'pass'
    );
    if (!fixture) throw new Error(`No passing replay witness: ${id}`);
    const capture = JSON.parse(
      readFixtureText(
        path.join(root, 'packages/lexical-conformance/fixtures', fixture.file)
      )
    );
    const test = `upstream::${fixture.file.split('/')[1]}::${capture.source.test.join(' > ').replaceAll('\r', '\\r').replaceAll('\n', '\\n')}`;
    if (!passed.has(test))
      throw new Error(`Passing replay missing from log: ${test}`);
    return { id, fixture: fixture.file, test, status: 'pass' };
  });
const counts = { pass: 0, fail: 0, ledger: 0 };
for (const result of Object.values(replay.cases)) counts[result.status]++;
writeFileSync(
  reportFile,
  JSON.stringify(
    {
      scope:
        'Historical replay output; CI still requires fresh runtime evidence',
      base,
      inputs: replay.inputs,
      logSHA256: hash(log),
      counts,
      before: baseline.size,
      pending: remaining.length,
      removed,
    },
    null,
    2
  ) + '\n'
);
writeFileSync(pendingFile, remaining.join('\n') + '\n');
console.log(
  `${removed.length} verified rows removed; ${remaining.length} pending; ${counts.pass} pass / ${counts.fail} fail / ${counts.ledger} ledger`
);
