import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import { decodeHostPacket } from './host-packet';

const node = createRequire(import.meta.url)(
  '../pkg/node/lexical_conformance_wasm.js'
) as typeof import('../pkg/node/lexical_conformance_wasm');

test('model command priorities deduplicate callbacks and preserve opaque payload identity', () => {
  const editor = new node.EditorHandle({ namespace: 'listeners', nodes: [] });
  const index = node.EditorHandle.api_index();
  const create = index.indexOf('lexical.$createTextNode');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const append = index.indexOf('LexicalNode.append');
  const root = index.indexOf('lexical.$getRoot');
  const calls: string[] = [];
  const payload: { cycle?: unknown } = {};
  payload.cycle = payload;
  let reads = 0;
  Object.defineProperty(payload, 'detail', {
    enumerable: true,
    get() {
      reads++;
      throw new Error('payload must stay opaque');
    },
  });
  editor.register_listener('unrelated', 4, () => {
    throw new Error('wrong command');
  });
  editor.register_listener('insert', 0, () => {
    calls.push('low');
    return false;
  });
  const high = (value: unknown) => {
    expect(value).toBe(payload);
    calls.push('high');
    const t = editor.call(create, { args: ['from listener'] });
    const p = editor.call(paragraph, { args: [] });
    editor.call(append, { this: p, args: [t] });
    editor.call(append, { this: editor.call(root, { args: [] }), args: [p] });
    return false;
  };
  const registration = editor.register_listener('insert', 3, high);
  expect(editor.register_listener('insert', 3, high)).toBe(registration);
  editor.register_listener('insert', 4, (value: unknown) => {
    expect(value).toBe(payload);
    calls.push('critical');
    return false;
  });
  const stop = editor.register_listener('insert', 3, () => {
    calls.push('stop');
    return true;
  });
  try {
    expect(() => editor.dispatch_command('insert', payload)).toThrow(
      'no API update is active'
    );
    editor.begin_update([], false);
    expect(editor.dispatch_command('missing', payload)).toBe(false);
    expect(editor.dispatch_command('insert', payload)).toBe(true);
    expect(calls).toEqual(['critical', 'high', 'stop']);
    expect(reads).toBe(0);
    const packet = decodeHostPacket(editor.commit());
    expect(JSON.parse(packet.metadata_json).records).toContainEqual(
      expect.objectContaining({ __text: 'from listener' })
    );
    editor.unregister(registration);
    editor.unregister(registration);
    editor.unregister(stop);
    editor.begin_update([], false);
    expect(editor.dispatch_command('insert', payload)).toBe(false);
    editor.commit();
    expect(calls).toEqual(['critical', 'high', 'stop', 'critical', 'low']);
  } finally {
    editor.free();
  }
  expect(node.debug_live_editors()).toBe(0);
});

test('command registration snapshots each priority and supports nested dispatch', () => {
  const editor = new node.EditorHandle({
    namespace: 'listener snapshots',
    nodes: [],
  });
  const calls: string[] = [];
  let changed = false;
  let removed = -1;
  const payload = new Map([['value', 1]]);
  editor.register_listener('nested', 2, (value: unknown) => {
    expect(value).toBe(payload);
    calls.push('nested');
    return false;
  });
  editor.register_listener('outer', 4, () => {
    calls.push('critical');
    expect(editor.dispatch_command('nested', payload)).toBe(false);
    if (!changed) {
      changed = true;
      editor.unregister(removed);
      editor.register_listener('outer', 4, () => {
        calls.push('new-critical');
        return false;
      });
      editor.register_listener('outer', 1, () => {
        calls.push('new-low');
        return false;
      });
    }
    return false;
  });
  removed = editor.register_listener('outer', 4, () => {
    calls.push('removed-current-snapshot');
    return false;
  });
  try {
    editor.begin_update([], false);
    expect(editor.dispatch_command('outer', payload)).toBe(false);
    expect(calls).toEqual([
      'critical',
      'nested',
      'removed-current-snapshot',
      'new-low',
    ]);
    calls.length = 0;
    expect(editor.dispatch_command('outer', payload)).toBe(false);
    expect(calls).toEqual(['critical', 'nested', 'new-critical', 'new-low']);
    editor.commit();
  } finally {
    editor.free();
  }
});

test('caught command exceptions leave the current update usable and retain thrown identity', () => {
  const editor = new node.EditorHandle({
    namespace: 'listener errors',
    nodes: [],
  });
  const index = node.EditorHandle.api_index();
  const root = index.indexOf('lexical.$getRoot');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const append = index.indexOf('LexicalNode.append');
  const thrown = { opaque: true };
  const error = editor.register_listener('throw', 2, () => {
    throw thrown;
  });
  editor.register_listener('catch', 2, () => {
    let caught = false;
    try {
      editor.dispatch_command('throw', undefined);
    } catch (value) {
      caught = true;
      expect(value).toBe(thrown);
    }
    expect(caught).toBe(true);
    const p = editor.call(paragraph, { args: [] });
    editor.call(append, { this: editor.call(root, { args: [] }), args: [p] });
    return true;
  });
  try {
    expect(() => editor.register_listener('invalid', 5, () => true)).toThrow(
      'invalid command priority'
    );
    editor.begin_update([], false);
    expect(editor.dispatch_command('catch', undefined)).toBe(true);
    editor.unregister(error);
    const packet = decodeHostPacket(editor.commit());
    expect(JSON.parse(packet.metadata_json).records).toContainEqual(
      expect.objectContaining({ __type: 'paragraph' })
    );
    editor.begin_update([], true);
    editor.commit();
  } finally {
    editor.free();
  }
});

test('listener return values use JavaScript truthiness without coercion hooks', () => {
  const editor = new node.EditorHandle({ namespace: 'truthiness', nodes: [] });
  let answer: unknown = 'stop';
  let lowCalls = 0;
  let coercions = 0;
  editor.register_listener('truthy', 2, () => answer);
  editor.register_listener('truthy', 1, () => {
    lowCalls++;
    return false;
  });
  try {
    editor.begin_update([], false);
    expect(editor.dispatch_command('truthy', null)).toBe(true);
    answer = Object.defineProperty({}, Symbol.toPrimitive, {
      get() {
        coercions++;
        throw new Error('must not coerce');
      },
    });
    expect(editor.dispatch_command('truthy', null)).toBe(true);
    expect(coercions).toBe(0);
    expect(lowCalls).toBe(0);
    answer = 0;
    expect(editor.dispatch_command('truthy', null)).toBe(false);
    answer = '';
    expect(editor.dispatch_command('truthy', null)).toBe(false);
    expect(lowCalls).toBe(2);
    editor.commit();
  } finally {
    editor.free();
  }
});
