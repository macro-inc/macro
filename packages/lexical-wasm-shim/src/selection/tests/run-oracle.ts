import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oracleCases } from './oracle-cases';

const source = process.env.LEXICAL_SELECTION_UPSTREAM_ROOT;
if (!source) throw new Error('LEXICAL_SELECTION_UPSTREAM_ROOT is required');
const engine = process.env.LEXICAL_SELECTION_ENGINE ?? 'portDOM+upstreammodel';
if (engine !== 'portDOM+upstreammodel' && engine !== 'actual-native') {
  throw new Error('Unknown selection oracle engine');
}
const directory =
  process.env.LEXICAL_SELECTION_REPORT_DIR ??
  join(tmpdir(), 'lexical-selection-oracle', engine);
mkdirSync(directory, { recursive: true });
const report = join(directory, 'vitest.json');
if (existsSync(report)) {
  copyFileSync(report, `${report}.previous-${Date.now()}`);
  unlinkSync(report);
}
const sha = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const before = oracleCases.map((spec) => ({
  ...spec,
  observedSha256: sha(resolve(source, spec.file)),
}));
if (before.some((spec) => spec.sha256 !== spec.observedSha256)) {
  throw new Error('Original selection oracle differs from its pinned source');
}
const config = fileURLToPath(new URL('./upstream.config.mts', import.meta.url));
const start = Date.now();
const run = spawnSync(
  'node',
  [
    resolve(source, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    config,
    '--project',
    'unit',
    '--retry=0',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${report}`,
  ],
  {
    cwd: source,
    env: { ...process.env, npm_package_version: '0.45.0' },
    stdio: 'inherit',
  }
);
const after = oracleCases.map((spec) => ({
  ...spec,
  observedSha256: sha(resolve(source, spec.file)),
}));
const changed = after.filter((spec) => spec.sha256 !== spec.observedSha256);
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(report, 'utf8'));
} catch {
  raw = null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const suites: unknown[] =
  isRecord(raw) && Array.isArray(raw.testResults) ? raw.testResults : [];
const counts = oracleCases.map((spec) => {
  const suite = suites.find(
    (entry) => isRecord(entry) && entry.name === resolve(source, spec.file)
  );
  const assertions: unknown[] =
    isRecord(suite) && Array.isArray(suite.assertionResults)
      ? suite.assertionResults
      : [];
  return {
    file: spec.file,
    expected: spec.cases,
    actual: assertions.length,
    passed: assertions.filter(
      (entry) => isRecord(entry) && entry.status === 'passed'
    ).length,
  };
});
const success =
  run.status === 0 &&
  changed.length === 0 &&
  suites.length === 4 &&
  counts.every(
    (row) => row.actual === row.expected && row.passed === row.expected
  );
writeFileSync(
  join(directory, 'provenance.json'),
  JSON.stringify(
    {
      engine,
      nativeAcceptance: false,
      candidateNativeSelectionRun: engine === 'actual-native',
      sourceCommit: '0cfcc169296723e07de2396cd42ea3434b5b79ed',
      expectedCases: 65,
      sourceRoot: source,
      specIntegrity: changed.length === 0,
      before,
      after,
      counts,
      configSha256: sha(config),
      elapsedMs: Date.now() - start,
      processStatus: run.status,
      success,
    },
    null,
    2
  ) + '\n'
);
console.log(JSON.stringify({ engine, success, counts }));
if (!success) process.exitCode = 1;
