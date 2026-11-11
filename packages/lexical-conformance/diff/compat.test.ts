import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from 'vitest';
import * as web from '../pkg/web/lexical_conformance_wasm';

const node = createRequire(import.meta.url)(
  '../pkg/node/lexical_conformance_wasm.js'
) as typeof import('../pkg/node/lexical_conformance_wasm');

test('compat format exports are plain objects with all eleven upstream bits', () => {
  web.initSync({
    module: readFileSync(
      path.resolve(
        import.meta.dirname,
        '../pkg/web/lexical_conformance_wasm_bg.wasm'
      )
    ),
  });
  expect(node.text_format_flags()).toEqual({
    IS_BOLD: 1,
    IS_ITALIC: 2,
    IS_STRIKETHROUGH: 4,
    IS_UNDERLINE: 8,
    IS_CODE: 16,
    IS_SUBSCRIPT: 32,
    IS_SUPERSCRIPT: 64,
    IS_HIGHLIGHT: 128,
    IS_LOWERCASE: 256,
    IS_UPPERCASE: 512,
    IS_CAPITALIZE: 1024,
  });
  expect(web.text_format_flags()).toEqual(node.text_format_flags());
  expect(Object.getPrototypeOf(web.text_format_flags())).toBe(Object.prototype);
});

test('compat key allocation resets independently in each WASM instance', () => {
  web.initSync({
    module: readFileSync(
      path.resolve(
        import.meta.dirname,
        '../pkg/web/lexical_conformance_wasm_bg.wasm'
      )
    ),
  });
  node.reset_key_counter();
  web.reset_key_counter();
  expect(node.generate_random_key()).toBe('1');
  expect(node.generate_random_key()).toBe('2');
  expect(web.generate_random_key()).toBe('1');
  node.reset_key_counter();
  expect(node.generate_random_key()).toBe('1');
  expect(web.generate_random_key()).toBe('2');
  const core = new node.CoreHandle('upstream');
  try {
    expect(JSON.parse(core.snapshot()).keys).toEqual([
      { path: [], key: 'root' },
      { path: [0], key: '1' },
    ]);
  } finally {
    core.free();
  }
});
