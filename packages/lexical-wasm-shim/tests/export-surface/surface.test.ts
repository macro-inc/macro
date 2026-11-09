import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { imports } from './inventory';
import { compareDeclarationNames, compareRuntime } from './surface';

test('reports every missing, extra, wrong-kind and wrong-arity value together', () => {
  const result = compareRuntime(
    {
      status: 'evaluated',
      exports: new Map([
        ['missing-a', { kind: 'object' }],
        ['missing-b', { kind: 'function' }],
        ['kind', { kind: 'class', arity: 1 }],
        ['arity', { kind: 'function', arity: 2 }],
      ]),
    },
    {
      status: 'evaluated',
      exports: new Map([
        ['extra-a', { kind: 'object' }],
        ['extra-b', { kind: 'number' }],
        ['kind', { kind: 'function', arity: 1 }],
        ['arity', { kind: 'function', arity: 1 }],
      ]),
    }
  );
  expect(result.status).toBe('mismatch');
  expect(result.missing).toEqual(['missing-a', 'missing-b']);
  expect(result.extra).toEqual(['extra-a', 'extra-b']);
  expect(result.mismatches.map((fact) => fact.name)).toEqual(['kind', 'arity']);
});

test('an unavailable namespace cannot pass as an empty namespace', () => {
  expect(
    compareRuntime(
      { status: 'evaluated', exports: new Map() },
      { status: 'blocked', exports: new Map(), error: 'Missing source export' }
    ).status
  ).toBe('blocked');
});

test('declaration comparison includes all type-only and runtime names', () => {
  expect(
    compareDeclarationNames(
      ['Value', 'OnlyType', 'AnotherType'],
      ['Value', 'PrivateBinder']
    )
  ).toEqual({ missing: ['AnotherType', 'OnlyType'], extra: ['PrivateBinder'] });
});

test('discovers type imports, reexports, import queries and literal dynamic imports', () => {
  const source = ts.createSourceFile(
    'caller.ts',
    `
    import type {LexicalEditor} from 'lexical';
    export * from '@lexical/table';
    type Value = typeof import('@lexical/selection');
    import legacy = require('@lexical/utils');
    const load = () => import('@lexical/rich-text');
    const unrelated = () => import('other');
  `,
    ts.ScriptTarget.Latest,
    true
  );
  expect(imports(source)).toEqual([
    '@lexical/rich-text',
    '@lexical/selection',
    '@lexical/table',
    '@lexical/utils',
    'lexical',
  ]);
});

test('runtime package probes cannot silently resolve Original core after substitution', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lexical-bad-surface-'));
  const facade = join(directory, 'facade.ts');
  writeFileSync(facade, 'export const deliberatelyIncomplete = true;\n');
  const child = spawnSync(
    'bun',
    [
      fileURLToPath(new URL('./runtime-probe.ts', import.meta.url)),
      '@lexical/utils',
      facade,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  expect(child.status).toBe(1);
  expect(child.stdout).toContain('"status":"blocked"');
});
