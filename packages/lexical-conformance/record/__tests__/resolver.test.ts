import { expect, test } from 'vitest';
import { membranePlugin } from '../resolver';

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
