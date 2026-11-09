import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
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

const source = process.env.LEXICAL_NODES_UPSTREAM_ROOT;
if (!source || !process.env.LEXICAL_NODES_NATIVE_CONFIG) {
  throw new Error(
    'Actual-native node acceptance requires LEXICAL_NODES_UPSTREAM_ROOT and LEXICAL_NODES_NATIVE_CONFIG'
  );
}
const directory =
  process.env.LEXICAL_NODES_REPORT_DIR ??
  join(tmpdir(), 'lexical-nodes-oracle');
mkdirSync(directory, { recursive: true });
const report = join(directory, 'vitest.json');
if (existsSync(report)) unlinkSync(report);

function verifyOriginals(root: string): void {
  for (const spec of oracleCases) {
    const digest = createHash('sha256')
      .update(readFileSync(resolve(root, spec.file)))
      .digest('hex');
    if (digest !== spec.sha256)
      throw new Error(`Pinned node oracle changed: ${spec.file}`);
  }
}
verifyOriginals(source);
const runner =
  process.env.LEXICAL_NODES_VITEST ??
  resolve(source, 'node_modules/vitest/vitest.mjs');
const run = spawnSync(
  'node',
  [
    runner,
    'run',
    '--config',
    fileURLToPath(new URL('./upstream.config.mts', import.meta.url)),
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
verifyOriginals(source);
writeFileSync(
  join(directory, 'provenance.json'),
  `${JSON.stringify({ engine: 'actual-native', upstream: 'v0.45.0', specs: oracleCases, exitCode: run.status, error: run.error?.message, report }, null, 2)}\n`
);
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);
if (!existsSync(report))
  throw new Error('Native node oracle produced no report');
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const result: unknown = JSON.parse(readFileSync(report, 'utf8'));
if (!isRecord(result) || !Array.isArray(result.testResults))
  throw new Error('Invalid node oracle report');
const suites: unknown[] = result.testResults;
for (const spec of oracleCases) {
  const suite = suites.find(
    (entry) => isRecord(entry) && entry.name === resolve(source, spec.file)
  );
  if (
    !isRecord(suite) ||
    !Array.isArray(suite.assertionResults) ||
    suite.assertionResults.length !== spec.cases
  ) {
    throw new Error(`Node oracle suite case count differs: ${spec.file}`);
  }
}
