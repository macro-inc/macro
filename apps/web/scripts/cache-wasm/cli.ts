#!/usr/bin/env bun

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertInspection,
  inspectCacheWasmDist,
  inspectCacheWasmPackage,
  removeCacheWasmBrotliSidecar,
  writeCacheWasmBrotliSidecar,
} from './inspection';

const webRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const repoRoot = resolve(webRoot, '../..');

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const stringify = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, candidate) =>
      typeof candidate === 'bigint' ? candidate.toString() : candidate,
    2
  );

function print(value: unknown): void {
  process.stdout.write(`${stringify(value)}\n`);
}

const command = process.argv[2];
switch (command) {
  case 'inspect-package': {
    const inspection = inspectCacheWasmPackage(repoRoot);
    assertInspection('cache WASM package inspection', inspection);
    print(inspection);
    break;
  }
  case 'package-dist': {
    const distPath = resolve(argument('--dist', resolve(webRoot, 'dist')));
    const sidecarPath = writeCacheWasmBrotliSidecar(distPath);
    print({ sidecarPath });
    break;
  }
  case 'remove-sidecar': {
    const distPath = resolve(argument('--dist', resolve(webRoot, 'dist')));
    const removedPath = removeCacheWasmBrotliSidecar(distPath);
    print({ removedPath });
    break;
  }
  case 'inspect-dist': {
    const distPath = resolve(argument('--dist', resolve(webRoot, 'dist')));
    const expectedBase = argument('--base', '/app/');
    const inspection = inspectCacheWasmDist(repoRoot, distPath, expectedBase);
    assertInspection('cache WASM dist inspection', inspection);
    print(inspection);
    break;
  }
  default:
    throw new Error(
      'usage: cli.ts <inspect-package|package-dist|remove-sidecar|inspect-dist> [options]'
    );
}
