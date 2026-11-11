import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readModuleAbi, widths } from '../../scripts/measurement/abi';
import { instrumentGlue } from '../../scripts/measurement/glue';

describe('exact WASM ABI inventory', () => {
  it('keeps numeric ABI widths separate from opaque reference slots and resolves aliases', async () => {
    const abi = await readModuleAbi(
      Readable.from(`(module
 (import "host" "callback" (func $host (param externref i64) (result f64)))
 (export "entry" (func $body))
 (export "alias" (func $body))
 (export "callback" (func $host))
 (func $body (param $0 i32) (param $1 f32) (result i64 funcref)
  (nop)
 )
)`)
    );
    expect(widths(abi.exports.entry.parameters)).toEqual({ bytes: 8, refs: 0 });
    expect(widths(abi.exports.alias.results)).toEqual({ bytes: 8, refs: 1 });
    expect(abi.exports.alias).toBe(abi.exports.entry);
    expect(widths(abi.imports[0].parameters)).toEqual({ bytes: 8, refs: 1 });
    expect(() => widths(['newref'])).toThrow('Unaccounted');
  });

  it('rejects unknown import kinds and complex signatures rather than guessing a width', async () => {
    await expect(
      readModuleAbi(Readable.from(' (import "host" "memory" (memory 1))'))
    ).rejects.toThrow('Unsupported');
    await expect(
      readModuleAbi(Readable.from(' (func $x (param (ref null $T)))'))
    ).rejects.toThrow('Unsupported');
  });
});

describe('diagnostic glue isolation', () => {
  it('rejects table alias escapes and unknown memory accesses instead of undercounting', () => {
    expect(() =>
      instrumentGlue(
        'let wasm;const t=wasm.refs;const alias=t;alias.get(0);',
        { imports: [], exports: {}, tables: ['refs'] },
        'runtime',
        true
      )
    ).toThrow('table reference or alias');
    expect(() =>
      instrumentGlue(
        'let wasm;function f(){const t=wasm.refs;{const t=null;}t.get(0);}',
        { imports: [], exports: {}, tables: ['refs'] },
        'runtime',
        true
      )
    ).toThrow('binding or shadowing');
    expect(() =>
      instrumentGlue(
        'let wasm;const mem=wasm.memory.buffer;',
        { imports: [], exports: {}, tables: [] },
        'runtime',
        true
      )
    ).toThrow('Unaccounted direct WASM memory');
  });
  it('returns the exact source without imports or instrumentation when disabled', () => {
    const source = '\uFEFF/* keep bytes */\nunknown future generated glue\r\n';
    expect(
      instrumentGlue(
        source,
        { imports: [], exports: {}, tables: [] },
        'do-not-load',
        false
      )
    ).toEqual({
      source,
      apiMethods: [],
      physicalImports: [],
      physicalExports: [],
      payloadHelpers: [],
    });
  });

  it('requires complete physical and payload coverage before producing instrumented glue', () => {
    expect(() =>
      instrumentGlue(
        'export function x() {}',
        { imports: [], exports: {}, tables: [] },
        'runtime',
        true
      )
    ).toThrow('Incomplete');
    // Source modules themselves remain plain JS/TS and do not initialize a model.
    const source = readFileSync(
      new URL('../../src/measurement/runtime.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toContain('WebAssembly.');
    expect(source).not.toContain('conformance');
  });
});
