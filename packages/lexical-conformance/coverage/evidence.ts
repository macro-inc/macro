import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readFixtureText } from '../record/files';

export const root = path.resolve(import.meta.dirname, '../../..');
export const directory = path.join(
  root,
  'packages/lexical-conformance/coverage'
);
export const hash = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory())
        return /^(node_modules|target|pkg|results|\.git)$/.test(entry.name)
          ? []
          : files(file);
      return entry.isFile() ? [file] : [];
    });
}
export type IndexRow = {
  id: string;
  file: string | null;
  apis: string[];
  s2Hits: string[];
  transformersFired: string[];
};
export function index(): IndexRow[] {
  return JSON.parse(
    readFixtureText(
      path.join(root, 'packages/lexical-conformance/fixtures/index.json')
    )
  );
}
/** Bind native results to the exact corpus and implementation that executed. */
export function inputs(): string {
  const digest = createHash('sha256');
  const compiler = spawnSync('rustc', ['-Vv'], { encoding: 'utf8' });
  if (compiler.status !== 0)
    throw new Error('Cannot fingerprint the Rust compiler');
  digest.update(compiler.stdout);
  for (const key of [
    'RUSTFLAGS',
    'CARGO_ENCODED_RUSTFLAGS',
    'RUSTUP_TOOLCHAIN',
    'CARGO_BUILD_TARGET',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
  ])
    digest
      .update(key)
      .update(process.env[key] ?? '')
      .update('\0');
  const names = [
    'Cargo.lock',
    'Cargo.toml',
    'rust-toolchain.toml',
    '.cargo/config.toml',
    ...files(path.join(root, 'vendor')).map((file) =>
      path.relative(root, file)
    ),
    'packages/lexical-conformance/fixtures/index.json.gz',
    ...index().flatMap((row) =>
      row.file ? ['packages/lexical-conformance/fixtures/' + row.file] : []
    ),
    ...files(path.join(root, 'crates/client/lexical'))
      .filter((file) => /\.(rs|toml|json|txt)$/.test(file))
      .map((file) => path.relative(root, file)),
  ].sort();
  for (const name of names)
    digest
      .update(name)
      .update('\0')
      .update(readFileSync(path.join(root, name)));
  return digest.digest('hex');
}
export type ReplayEvidence = {
  inputs: string;
  cases: Record<
    string,
    { status: 'pass' | 'fail' | 'ledger'; error: string | null }
  >;
};
export function replayEvidence(): ReplayEvidence | undefined {
  const file = path.join(directory, 'results/replay.json');
  if (!existsSync(file)) return;
  const evidence: ReplayEvidence = JSON.parse(readFileSync(file, 'utf8'));
  if (evidence.inputs !== inputs())
    throw new Error('Stale Rust replay evidence: run just lexical-replay');
  const admitted = index()
    .flatMap((row) => (row.file ? [row.file] : []))
    .sort();
  if (
    JSON.stringify(Object.keys(evidence.cases).sort()) !==
    JSON.stringify(admitted)
  )
    throw new Error(
      'Rust replay evidence does not cover the entire admitted corpus'
    );
  if (
    Object.values(evidence.cases).some(
      (row) => !['pass', 'fail', 'ledger'].includes(row.status)
    )
  )
    throw new Error('Invalid Rust replay status');
  return evidence;
}
