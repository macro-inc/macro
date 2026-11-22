import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

const wasm = createRequire(import.meta.url)(
  '../pkg/node/lexical_conformance_wasm.js'
) as typeof import('../pkg/node/lexical_conformance_wasm');

test('indexed null values and raw null fields remain null instead of undefined', () => {
  const editor = new wasm.EditorHandle({ namespace: 'null values', nodes: [] });
  const index = wasm.EditorHandle.api_index();
  try {
    editor.begin_update([], false);
    expect(
      editor.call(index.indexOf('lexical.$getSelection'), { args: [] })
    ).toBeNull();
    expect(
      editor.call(index.indexOf('lexical.$getCompositionKey'), { args: [] })
    ).toBeNull();
    expect(
      editor.call(index.indexOf('lexical.$getNodeByKey'), { args: ['missing'] })
    ).toBeNull();
    const text = editor.call(index.indexOf('lexical.$createTextNode'), {
      args: ['unattached'],
    });
    expect(editor.read_field(text.$h, '__parent')).toBeNull();
    expect(editor.read_field(text.$h, '__prev')).toBeNull();
    expect(editor.read_field(text.$h, '__next')).toBeNull();
    expect(
      editor.call(index.indexOf('lexical.$setCompositionKey'), { args: [null] })
    ).toEqual({ $undef: true });
    editor.discard_update();
  } finally {
    editor.free();
  }
});
