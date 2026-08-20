#!/usr/bin/env bun

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from 'node:zlib';

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function oneMatchingFile(distPath: string, pattern: RegExp): string {
  const matches = walkFiles(distPath).filter((path) =>
    pattern.test(basename(path))
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected one cache WASM artifact in ${distPath}, found ${matches.length}`
    );
  }
  return matches[0];
}

const distPath = resolve(
  argument('--dist', resolve(import.meta.dirname, '../../dist'))
);
const command = process.argv[2];

switch (command) {
  case 'package-dist': {
    const wasmPath = oneMatchingFile(
      distPath,
      /^cache_wasm_bg(?:-[\w-]+)?\.wasm$/
    );
    const raw = readFileSync(wasmPath);
    const compressed = brotliCompressSync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
      },
    });
    if (!brotliDecompressSync(compressed).equals(raw)) {
      throw new Error(
        'Brotli sidecar does not decompress to the raw cache WASM'
      );
    }
    const sidecarPath = `${wasmPath}.br`;
    writeFileSync(sidecarPath, compressed);
    process.stdout.write(`${sidecarPath}\n`);
    break;
  }
  case 'remove-sidecar': {
    const sidecarPath = oneMatchingFile(
      distPath,
      /^cache_wasm_bg(?:-[\w-]+)?\.wasm\.br$/
    );
    rmSync(sidecarPath);
    process.stdout.write(`${sidecarPath}\n`);
    break;
  }
  default:
    throw new Error(
      'usage: cli.ts <package-dist|remove-sidecar> --dist <directory>'
    );
}
