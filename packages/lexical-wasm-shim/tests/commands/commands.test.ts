import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as originalCommands from '@pinned-core/commands';
import * as originalConstants from '@pinned-core/constants';
import * as originalTags from '@pinned-core/tags';
import { buildSync } from 'esbuild';
import { expect, test } from 'vitest';
import * as commands from '../../src/commands';
import * as constants from '../../src/constants';
import * as first from './consumer-a';
import * as second from './consumer-b';

test('all pinned command objects preserve diagnostic descriptors and distinct identity', () => {
  const original: Record<string, unknown> = originalCommands,
    actual: Record<string, unknown> = commands;
  const objects = [];
  for (const [name, value] of Object.entries(original)) {
    if (name === 'createCommand') continue;
    expect(actual[name]).toEqual(value);
    expect(actual[name]).not.toBe(value);
    objects.push(actual[name]);
    expect(Object.getOwnPropertyDescriptors(actual[name])).toEqual(
      Object.getOwnPropertyDescriptors(value)
    );
  }
  expect(new Set(objects).size).toBe(objects.length);
  expect(objects.length).toBe(49);
  expect(first.FORMAT_TEXT_COMMAND).toBe(second.FORMAT_TEXT_COMMAND);
  expect(first.SELECTION_CHANGE_COMMAND).toBe(
    commands.SELECTION_CHANGE_COMMAND
  );
  expect(commands.KEY_DOWN_COMMAND.type).toBe('KEYDOWN_COMMAND');
});

test('createCommand preserves mutable own type field and names never merge identities', () => {
  const a = commands.createCommand('same'),
    b = commands.createCommand('same');
  expect(a).not.toBe(b);
  expect(a).toEqual(originalCommands.createCommand('same'));
  expect(Object.getOwnPropertyDescriptors(commands.createCommand())).toEqual(
    Object.getOwnPropertyDescriptors(originalCommands.createCommand())
  );
  const callbacks = new WeakMap<object, string>([
    [a, 'a'],
    [b, 'b'],
  ]);
  a.type = 'changed';
  expect(callbacks.get(a)).toBe('a');
  expect(callbacks.get(b)).toBe('b');
});

test('numeric flags, maps, regexes and update tags match real pinned modules', () => {
  const actual: Record<string, unknown> = constants;
  for (const [key, value] of Object.entries({
    ...originalConstants,
    ...originalTags,
  })) {
    if (value instanceof RegExp) {
      expect(actual[key]).toBeInstanceOf(RegExp);
      expect(String(actual[key])).toBe(String(value));
    } else expect(actual[key]).toEqual(value);
  }
  expect([
    constants.COMMAND_PRIORITY_EDITOR,
    constants.COMMAND_PRIORITY_LOW,
    constants.COMMAND_PRIORITY_NORMAL,
    constants.COMMAND_PRIORITY_HIGH,
    constants.COMMAND_PRIORITY_CRITICAL,
  ]).toEqual([0, 1, 2, 3, 4]);
  expect([
    constants.COMMAND_PRIORITY_BEFORE_EDITOR,
    constants.COMMAND_PRIORITY_BEFORE_LOW,
    constants.COMMAND_PRIORITY_BEFORE_NORMAL,
    constants.COMMAND_PRIORITY_BEFORE_HIGH,
    constants.COMMAND_PRIORITY_BEFORE_CRITICAL,
  ]).toEqual([-8, -7, -6, -5, -4]);
});

test('cold imports and runtime dependency graph require neither engine nor upstream runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'commands-cold-'));
  try {
    const module = resolve(import.meta.dirname, '../../src/commands.ts'),
      values = resolve(import.meta.dirname, '../../src/constants.ts');
    const script = join(root, 'cold.ts');
    writeFileSync(
      script,
      `Object.defineProperty(globalThis,'WebAssembly',{get(){throw new Error('engine touched');}});await import(${JSON.stringify(module)});await import(${JSON.stringify(values)});console.log('cold-safe');`
    );
    expect(execFileSync('bun', [script], { encoding: 'utf8' }).trim()).toBe(
      'cold-safe'
    );
    const bundled = buildSync({
      entryPoints: [module, values],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      outdir: join(root, 'bundle'),
      write: false,
      metafile: true,
    });
    const paths = Object.keys(bundled.metafile.inputs);
    expect(
      paths.some(
        (path) =>
          path.includes('/backend/') ||
          path.endsWith('/editor.ts') ||
          path.includes('/node_modules/lexical/') ||
          path.includes('/node_modules/@lexical/')
      )
    ).toBe(false);
    expect(paths.some((path) => path.endsWith('/compat/environment.ts'))).toBe(
      true
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
