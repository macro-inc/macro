import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  CoreHandle,
  initSync,
  upstream_version,
} from '../pkg/web/lexical_conformance_wasm';
import { RustCore } from './loader';

test('optimized Node and web bindings own isolated editor handles', () => {
  initSync({
    module: readFileSync(
      path.resolve(
        import.meta.dirname,
        '../pkg/web/lexical_conformance_wasm_bg.wasm'
      )
    ),
  });
  const pin = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, '../upstream.lock'), 'utf8')
  ) as { version: string };
  expect(upstream_version()).toBe(pin.version);
  const node = new RustCore('upstream');
  const web = new CoreHandle('upstream');
  const untouched = new CoreHandle('upstream');
  try {
    const command = JSON.stringify({ kind: 'InsertText', text: 'hello 😀' });
    expect(JSON.parse(web.apply(command, 0))).toEqual(
      JSON.parse(node.apply(command, 0))
    );
    expect(JSON.parse(untouched.snapshot()).text).toBe('');
    expect(JSON.parse(web.state_json())).toEqual(JSON.parse(node.state_json()));
    expect(JSON.parse(web.selection_json())).toEqual(
      JSON.parse(node.selection_json())
    );
    expect(() => web.apply(command, Number.NaN)).toThrow();
    expect(JSON.parse(web.snapshot()).text).toBe('hello 😀');
  } finally {
    node.free();
    web.free();
    untouched.free();
  }
});
