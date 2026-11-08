import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from 'vitest';
import * as web from '../pkg/web/lexical_conformance_wasm';

const node = createRequire(import.meta.url)(
  '../pkg/node/lexical_conformance_wasm.js'
) as typeof import('../pkg/node/lexical_conformance_wasm');

test('Node crossing observations include their own entry and reset starts a new interval', () => {
  node.debug_reset_counters();
  expect(node.debug_crossings()).toBe(1);
  expect(node.debug_crossings()).toBe(2);
  node.debug_reset_counters();
  expect(node.debug_crossings()).toBe(1);
});

test('web raw allocator exports and the reserved helper count actual entries exactly once', () => {
  const raw = web.initSync({
    module: readFileSync(
      path.resolve(
        import.meta.dirname,
        '../pkg/web/lexical_conformance_wasm_bg.wasm'
      )
    ),
  });
  web.debug_reset_counters();
  const pointer = raw.__wbindgen_malloc(8, 1);
  const resized = raw.__wbindgen_realloc(pointer, 8, 16, 1);
  raw.__wbindgen_free(resized, 16, 1);
  expect(web.debug_crossings()).toBe(4);
  raw.__lexical_record_export_entry(0);
  expect(web.debug_crossings()).toBe(6);
  node.debug_reset_counters();
  expect(node.debug_crossings()).toBe(1);
  expect(web.debug_crossings()).toBe(7);
});

test('Node editor lifetimes exclude failed constructors and end at generated free', () => {
  expect(node.debug_live_editors()).toBe(0);
  expect(() => new node.CoreHandle('unsupported')).toThrow();
  expect(node.debug_live_editors()).toBe(0);
  const first = new node.CoreHandle('upstream');
  try {
    const second = new node.RichHandle();
    try {
      expect(node.debug_live_editors()).toBe(2);
    } finally {
      second.free();
    }
    expect(node.debug_live_editors()).toBe(1);
    node.debug_reset_counters();
    expect(node.debug_live_editors()).toBe(1);
    expect(node.debug_crossings()).toBe(2);
  } finally {
    first.free();
  }
  expect(node.debug_live_editors()).toBe(0);
});

test('generated repeated frees count their trapping entries without dropping another editor', () => {
  const core = new node.CoreHandle('upstream');
  core.free();
  node.debug_reset_counters();
  expect(() => core.free()).toThrow('null pointer passed to rust');
  expect(() => core.free()).toThrow('null pointer passed to rust');
  expect(node.debug_crossings()).toBe(3);
  expect(node.debug_live_editors()).toBe(0);
});
