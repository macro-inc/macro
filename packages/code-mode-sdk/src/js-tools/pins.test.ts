// The analyzer's soundness rests on what the pinned interpreter has: these
// tests fail on an upgrade that changes it. Read `interpreter-support.md`'s
// diff, give every new global or binding form an analyzer rule, then update
// them.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeRuntime } from './runtime';

// The directory of the package `name` resolves to from here.
function packageDirectory(name: string): string {
  let directory = dirname(fileURLToPath(import.meta.resolve(name)));
  while (!existsSync(join(directory, 'package.json')))
    directory = dirname(directory);
  return directory;
}

function version(name: string): string {
  return JSON.parse(
    readFileSync(join(packageDirectory(name), 'package.json'), 'utf8')
  ).version;
}

const codemode = packageDirectory('@opencode/codemode');

describe('the pinned interpreter', () => {
  it('is @opencode/codemode 2.3.2, with the parser and Effect it was built with', () => {
    const manifest = JSON.parse(
      readFileSync(join(codemode, 'package.json'), 'utf8')
    );
    expect(manifest.version).toBe('2.3.2');
    expect(version('acorn')).toBe(manifest.dependencies.acorn);
    expect(version('codemode-effect')).toBe(manifest.dependencies.effect);
  });

  it('binds exactly these globals', async () => {
    // Not in the package's exports: imported by its file.
    const { globalNames } = await import(
      join(codemode, 'dist/language/runtime/globals.js')
    );
    expect([...globalNames].sort()).toEqual(
      [
        'AggregateError',
        'Array',
        'Boolean',
        // Only where the host has one (Node, Bun and Deno do); a copy of bytes.
        'Buffer',
        'Date',
        'Error',
        'EvalError',
        'Function',
        'Headers',
        'Infinity',
        'Iterator',
        'JSON',
        'Map',
        'Math',
        'NaN',
        'Number',
        'Object',
        'Promise',
        'RangeError',
        'ReferenceError',
        'RegExp',
        'Set',
        'String',
        'Symbol',
        'SyntaxError',
        'TextDecoder',
        'TextEncoder',
        'TypeError',
        'URIError',
        'URL',
        'URLSearchParams',
        'Uint8Array',
        'WeakMap',
        'WeakSet',
        'atob',
        'btoa',
        'console',
        'crypto',
        'decodeURI',
        'decodeURIComponent',
        'encodeURI',
        'encodeURIComponent',
        'isFinite',
        'isNaN',
        'parseFloat',
        'parseInt',
        // Loads any global by name; the analyzer refuses every use (A1).
        'require',
        'structuredClone',
        'undefined',
      ].sort()
    );
  });

  it('has no global object, dynamic code, reflection or host access', async () => {
    const runtime = makeRuntime({
      catalog: { tools: [], defs: {}, skipped: [] },
      admitted: new Set(),
      call: () => Promise.reject(new Error('no tools')),
      limits: { timeoutMs: 5000, maxToolCalls: 1, maxOutputBytes: 4096 },
    });
    const names = [
      'globalThis',
      'eval',
      'Proxy',
      'Reflect',
      'fetch',
      'Deno',
      'process',
      'setTimeout',
      'WebAssembly',
      'module',
      'window',
      'self',
    ];
    const result = await runtime.execute(
      `const modules = ["fs", "child_process", "net", "http", "process", "os"].map((name) => { try { return typeof require(name) } catch { return "missing" } }); return [${names.map((name) => `typeof ${name}`).join(', ')}, typeof this, modules]`,
      {}
    );
    expect(result).toMatchObject({
      ok: true,
      value: [
        ...names.map(() => 'undefined'),
        'undefined',
        ['missing', 'missing', 'missing', 'missing', 'missing', 'missing'],
      ],
    });
  });
});
