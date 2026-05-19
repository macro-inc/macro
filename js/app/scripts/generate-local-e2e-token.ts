#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRepoRoot(): string {
  let current = resolve(dirname(fileURLToPath(import.meta.url)));

  while (true) {
    if (existsSync(join(current, 'rust/cloud-storage/Cargo.toml'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error('Could not find repo root from local E2E token script');
    }
    current = parent;
  }
}

const repoRoot = findRepoRoot();
const token = execFileSync(
  'cargo',
  [
    'run',
    '--quiet',
    '--manifest-path',
    join(repoRoot, 'rust/cloud-storage/Cargo.toml'),
    '-p',
    'local_e2e_test_support',
    '--bin',
    'generate_local_e2e_token',
    '--',
    ...process.argv.slice(2),
  ],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }
).trim();

console.log(token);
