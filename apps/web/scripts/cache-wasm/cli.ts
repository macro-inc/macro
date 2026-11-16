#!/usr/bin/env bun

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
} from 'node:zlib';
import { fromThrowable } from 'neverthrow';
import { match } from 'ts-pattern';

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

function compressWasm(raw: Buffer): Buffer {
  return brotliCompressSync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
    },
  });
}

const decompress = fromThrowable((compressed: Buffer) =>
  brotliDecompressSync(compressed)
);

function decompressesTo(compressed: Buffer, raw: Buffer): boolean {
  return decompress(compressed)
    .map((bytes) => bytes.equals(raw))
    .unwrapOr(false);
}

const readSidecar = fromThrowable((path: string) => readFileSync(path));

/**
 * A sidecar `precompress` wrote during the build, if it holds exactly `raw`.
 * Anything else (missing, unreadable, stale, cut short) is ignored.
 */
function precompressedSidecar(
  path: string | undefined,
  raw: Buffer
): Buffer | undefined {
  if (path === undefined) return undefined;
  return readSidecar(path)
    .map((candidate) => (decompressesTo(candidate, raw) ? candidate : undefined))
    .unwrapOr(undefined);
}

const distPath = resolve(
  argument('--dist', resolve(import.meta.dirname, '../../dist'))
);
const command = process.argv[2];

function packageDist() {
  const wasmPath = oneMatchingFile(distPath, /^cache_wasm_bg(?:-[\w-]+)?\.wasm$/);
  const raw = readFileSync(wasmPath);
  const reused = precompressedSidecar(optionalArgument('--precompressed'), raw);
  if (reused !== undefined) {
    process.stderr.write('using the sidecar compressed during the build\n');
  }
  const compressed = reused ?? compressWasm(raw);
  if (!decompressesTo(compressed, raw)) {
    throw new Error('Brotli sidecar does not decompress to the raw cache WASM');
  }
  const sidecarPath = `${wasmPath}.br`;
  writeFileSync(sidecarPath, compressed);
  process.stdout.write(`${sidecarPath}\n`);
}

// Compresses the wasm-pack output, so a build can do it while Vite runs: Vite
// copies the file into dist unchanged, and `package-dist --precompressed` uses
// this copy only if it decompresses to the bytes there.
function precompress() {
  const outPath = resolve(argument('--out'));
  const compressed = compressWasm(readFileSync(resolve(argument('--wasm'))));
  mkdirSync(dirname(outPath), { recursive: true });
  // Renamed into place, so a reader never sees a partial file.
  const partialPath = `${outPath}.${process.pid}.partial`;
  writeFileSync(partialPath, compressed);
  renameSync(partialPath, outPath);
  process.stdout.write(`${outPath}\n`);
}

function removeSidecar() {
  const sidecarPath = oneMatchingFile(
    distPath,
    /^cache_wasm_bg(?:-[\w-]+)?\.wasm\.br$/
  );
  rmSync(sidecarPath);
  process.stdout.write(`${sidecarPath}\n`);
}

match(command)
  .with('package-dist', packageDist)
  .with('precompress', precompress)
  .with('remove-sidecar', removeSidecar)
  .otherwise(() => {
    throw new Error(
      'usage: cli.ts <package-dist [--precompressed <file>]|remove-sidecar> --dist <directory>\n' +
        '       cli.ts precompress --wasm <file> --out <file>'
    );
  });
