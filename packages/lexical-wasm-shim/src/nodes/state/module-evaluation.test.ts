import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('state configuration and algorithms load without initializing an engine', () => {
  const entry = new URL('./index.ts', import.meta.url).href;
  const result = spawnSync(
    'bun',
    [
      '-e',
      `
    for (const name of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming']) {
      WebAssembly[name] = () => { throw new Error('unexpected engine initialization'); };
    }
    const state = await import(${JSON.stringify(entry)});
    const opaque = {};
    const config = state.createState('opaque', {parse: () => opaque});
    if (config.defaultValue !== opaque) throw new Error('opaque default identity changed');
    process.stdout.write('state ready without engine');
  `,
    ],
    { encoding: 'utf8' }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('state ready without engine');
});
