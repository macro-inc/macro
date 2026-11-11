import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('node classes evaluate before WASM initialization and editor creation waits for the engine', () => {
  const entry = new URL('../index.ts', import.meta.url).href;
  const result = spawnSync(
    'bun',
    [
      '-e',
      `
    for (const name of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming']) {
      WebAssembly[name] = () => { throw new Error('WASM initialization during module evaluation'); };
    }
    const compat = await import(${JSON.stringify(entry)});
    class CustomText extends compat.TextNode {
      static getType() { return 'custom-before-engine'; }
    }
    if (CustomText.getType() !== 'custom-before-engine') throw new Error('class evaluation failed');
    try {
      compat.createEditor();
      throw new Error('editor creation must wait for initialization');
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Lexical engine has not been initialized') throw error;
    }
    process.stdout.write('module ready without WASM');
  `,
    ],
    { encoding: 'utf8' }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('module ready without WASM');
});
