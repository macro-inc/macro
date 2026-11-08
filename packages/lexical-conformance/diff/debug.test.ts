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

test('byte observations include numeric output and reset clears both counters', () => {
  node.debug_reset_counters();
  expect(node.debug_boundary_bytes()).toBe(8);
  expect(node.debug_boundary_bytes()).toBe(16);
  node.debug_reset_counters();
  expect(node.debug_crossings()).toBe(1);
  expect(node.debug_boundary_bytes()).toBe(16);
});

test('constructors count their input strings and only successful output handles', () => {
  node.debug_reset_counters();
  const core = new node.CoreHandle('upstream');
  try {
    expect(node.debug_boundary_bytes()).toBe(28);
  } finally {
    core.free();
  }
  node.debug_reset_counters();
  expect(() => new node.CoreHandle('é😀\ud800')).toThrow(
    'v0 supports only the upstream profile'
  );
  // Four UTF-16 input units, 37 error units and this f64 observation.
  expect(node.debug_boundary_bytes()).toBe(90);
});

test('input strings and scalar arguments count before a freed receiver traps', () => {
  const core = new node.CoreHandle('upstream');
  core.free();
  node.debug_reset_counters();
  expect(() => core.apply('é😀\ud800', 0)).toThrow(
    'null pointer passed to rust'
  );
  // Receiver/f64=12, four input units=8, 27 error units=54, observer=8.
  expect(node.debug_boundary_bytes()).toBe(82);
  expect(node.debug_crossings()).toBeGreaterThan(2);
});

test('JSON arguments and returned strings use UTF-16 bytes rather than UTF-8 storage', () => {
  const core = new node.CoreHandle('upstream');
  try {
    const input = JSON.stringify({ kind: 'InsertText', text: 'aé😀' });
    node.debug_reset_counters();
    const output = core.apply(input, 1);
    expect(node.debug_boundary_bytes()).toBe(
      12 + input.length * 2 + output.length * 2 + 8
    );
    node.debug_reset_counters();
    const state = core.state_json();
    expect(node.debug_boundary_bytes()).toBe(4 + state.length * 2 + 8);
  } finally {
    core.free();
  }
});

test('allocator metadata carries no payload and free counts receivers even when trapping', () => {
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
  expect(web.debug_boundary_bytes()).toBe(8);
  const core = new web.CoreHandle('upstream');
  web.debug_reset_counters();
  core.free();
  expect(web.debug_boundary_bytes()).toBe(12);
  web.debug_reset_counters();
  expect(() => core.free()).toThrow('null pointer passed to rust');
  expect(web.debug_boundary_bytes()).toBe(66);
});

test('format objects count transferred keys and f64 values without JSON punctuation', () => {
  node.debug_reset_counters();
  node.text_format_flags();
  // 126 UTF-16 key units, eleven f64 values, and this f64 observation.
  expect(node.debug_boundary_bytes()).toBe(348);
});

test('present optional seeds and u32 rich arguments use their actual ABI positions', () => {
  const original = new node.CoreHandle('upstream');
  let seed: string;
  try {
    seed = original.state_json();
  } finally {
    original.free();
  }
  node.debug_reset_counters();
  const seeded = new node.CoreHandle('upstream', seed);
  try {
    expect(node.debug_boundary_bytes()).toBe(28 + seed.length * 2);
  } finally {
    seeded.free();
  }
  const rich = new node.RichHandle();
  try {
    const input = '{"kind":"Undo"}';
    node.debug_reset_counters();
    const output = rich.apply(input, 0);
    expect(node.debug_boundary_bytes()).toBe(
      8 + input.length * 2 + output.length * 2 + 8
    );
  } finally {
    rich.free();
  }
});

test('error values count their message strings after numeric input validation', () => {
  const core = new node.CoreHandle('upstream');
  try {
    node.debug_reset_counters();
    expect(() => core.apply('é😀', Number.NaN)).toThrow(
      'invalid monotonic time'
    );
    // Receiver/f64=12, three input units=6, 22 error units=44, observer=8.
    expect(node.debug_boundary_bytes()).toBe(70);
  } finally {
    core.free();
  }
});
