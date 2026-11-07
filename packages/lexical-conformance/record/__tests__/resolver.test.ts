import { expect, test } from 'vitest';
import { membranePlugin } from '../resolver';

test('disk replay uses production source and leaves test utilities unwrapped', async () => {
  const previous = process.env.LEXICAL_REPLAY_ONLY;
  process.env.LEXICAL_REPLAY_ONLY = '1';
  try {
    const plugin = membranePlugin();
    const transform = (code: string, file: string) =>
      Reflect.apply(plugin.transform as Function, {}, [
        code,
        `/lexical-upstream/packages/lexical/src/${file}`,
      ]);
    expect(
      (
        await transform(
          "const dev = process.env.NODE_ENV !== 'production';",
          'LexicalUtils.ts'
        )
      ).code
    ).toBe('const dev = false;');
    expect(
      await transform(
        'await editor.update(() => {});',
        '__tests__/utils/index.tsx'
      )
    ).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.LEXICAL_REPLAY_ONLY;
    else process.env.LEXICAL_REPLAY_ONLY = previous;
  }
});

test.each([
  ['lexical-list/src/utils.ts', '@lexical/list/utils'],
  ['lexical-list/src/index.ts', '@lexical/list'],
  ['lexical/src/LexicalUtils.ts', 'lexical/LexicalUtils'],
])('deep import %s retains its package identity', async (file, name) => {
  const plugin = membranePlugin();
  const result = await Reflect.apply(
    plugin.transform as Function,
    {
      resolve: async () => ({ id: `/lexical-upstream/packages/${file}` }),
    },
    [
      "import { helper } from '../utils';",
      '/lexical-upstream/packages/lexical-list/src/__tests__/unit/example.test.ts',
    ]
  );
  expect(result.code).toContain(JSON.stringify(name));
});

test.each(['on', 'off'])(
  'await instrumentation preserves update return values with membrane %s',
  async (mode) => {
    const previous = process.env.LEXICAL_MEMBRANE;
    process.env.LEXICAL_MEMBRANE = mode;
    try {
      const plugin = membranePlugin();
      const result = await Reflect.apply(plugin.transform as Function, {}, [
        'async function scenario() { return await object.update(7); }',
        '/lexical-upstream/packages/lexical/src/__tests__/unit/example.test.ts',
      ]);
      const evaluate = new Function(
        'object',
        result.code.split('\n').slice(1).join('\n') + '; return scenario();'
      );
      expect(
        await evaluate({ update: async (value: number) => value * 2 })
      ).toBe(14);
    } finally {
      if (previous === undefined) delete process.env.LEXICAL_MEMBRANE;
      else process.env.LEXICAL_MEMBRANE = previous;
    }
  }
);
