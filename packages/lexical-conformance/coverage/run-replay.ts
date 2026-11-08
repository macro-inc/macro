import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { directory, inputs, replayEvidence, root } from './evidence';

const fingerprint = inputs();
const output = path.join(root, 'target/lexical-conformance/cases.json');
rmSync(output, { force: true });
rmSync(path.join(directory, 'results/replay.json'), { force: true });
const result = spawnSync(
  'cargo',
  [
    'test',
    '-p',
    'lexical_conformance',
    '--test',
    'replay',
    '-j4',
    '--',
    '--test-threads',
    '4',
    '--report-coverage',
  ],
  { cwd: root, stdio: 'inherit', env: process.env }
);
if (result.error) throw result.error;
if (fingerprint !== inputs())
  throw new Error('Replay inputs changed during execution');
const cases = JSON.parse(readFileSync(output, 'utf8'));
mkdirSync(path.join(directory, 'results'), { recursive: true });
writeFileSync(
  path.join(directory, 'results/replay.json'),
  JSON.stringify({ inputs: fingerprint, cases }, null, 2) + '\n'
);
replayEvidence();
if (process.env.GITHUB_STEP_SUMMARY) {
  const counts: Record<string, { pass: number; fail: number; ledger: number }> =
    JSON.parse(
      readFileSync(
        path.join(root, 'target/lexical-conformance/results.json'),
        'utf8'
      )
    );
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    '\n| Package | Pass | Fail | Ledger |\n| --- | ---: | ---: | ---: |\n' +
      Object.entries(counts)
        .map(
          ([name, count]) =>
            `| ${name} | ${count.pass} | ${count.fail} | ${count.ledger} |`
        )
        .join('\n') +
      '\n'
  );
}
process.exitCode = result.status ?? 1;
