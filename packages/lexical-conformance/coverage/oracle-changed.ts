import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';

const base = process.env.LEXICAL_COVERAGE_BASE;
if (!base)
  throw new Error('Oracle change detection requires the fetched PR base SHA');
const changed = spawnSync('git', ['diff', '--name-only', base, 'HEAD'], {
  encoding: 'utf8',
});
if (changed.status !== 0) throw new Error(changed.stderr);
const paths = [
  'packages/lexical-core/**',
  'packages/loro-mirror/**',
  'services/lexical-service/**',
  'packages/lexical-conformance/record/**',
  'packages/lexical-conformance/upstream.lock',
  'packages/lexical-conformance/bun.lock',
  'packages/lexical-conformance/package.json',
  'packages/lexical-conformance/fixtures/**',
  'static_assets/markdown-golden.1.bin',
  'crates/slack_integration/tests/fixtures/native-message-links.json',
];
const oracle = changed.stdout
  .split('\n')
  .some((file) => paths.some((pattern) => matchesGlob(file, pattern)));
if (!process.env.GITHUB_OUTPUT) throw new Error('Missing GITHUB_OUTPUT');
appendFileSync(process.env.GITHUB_OUTPUT, `oracle=${oracle}\n`);
