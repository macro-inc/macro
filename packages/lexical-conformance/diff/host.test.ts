import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import { decodeHostPacket } from './host-packet';

const node = createRequire(import.meta.url)(
  '../pkg/node/lexical_conformance_wasm.js'
) as typeof import('../pkg/node/lexical_conformance_wasm');

test('indexed host suspends writes, flushes, publishes records and retains captured versions', () => {
  node.reset_key_counter();
  const editor = new node.EditorHandle({
    namespace: 'host',
    nodes: [],
    headless: true,
  });
  const index = node.EditorHandle.api_index();
  const getRoot = index.indexOf('lexical.$getRoot');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const text = index.indexOf('lexical.$createTextNode');
  const append = index.indexOf('LexicalNode.append');
  const setText = index.indexOf('LexicalNode.setTextContent');
  const latest = index.indexOf('LexicalNode.getLatest');
  expect([getRoot, paragraph, text, append, setText, latest]).not.toContain(-1);
  try {
    expect(() => editor.call(getRoot, { args: [] })).toThrow();
    editor.begin_update(['one', 'one', 'history-push'], false);
    const root = editor.call(getRoot, { args: [] });
    const p = editor.call(paragraph, { args: [] });
    const t = editor.call(text, { args: ['aé😀'] });
    editor.call(append, { this: p, args: [t] });
    editor.call(append, { this: root, args: [p] });
    editor.flush();
    expect(editor.read_field(t.$h, '__text')).toBe('aé😀');
    const first = decodeHostPacket(editor.commit());
    expect(first.words.slice(0, 2)).toEqual([1, 1]);
    const metadata = JSON.parse(first.metadata_json);
    expect(metadata.version).toBe(1);
    expect(metadata.tags).toEqual(['one', 'history-push']);
    expect(metadata.records).toContainEqual({
      __key: '2',
      __type: 'text',
      __parent: '1',
      __prev: null,
      __next: null,
      __text: 'aé😀',
      __format: 0,
      __style: '',
      __mode: 0,
      __detail: 0,
    });
    expect(metadata.mutations).toContainEqual({
      key: '2',
      mutation: 'created',
    });
    editor.begin_update([], true);
    const writable = editor.call(setText, { this: t, args: ['after'] });
    const current = editor.call(latest, { this: t, args: [] });
    expect(current.$h).toBe(writable.$h);
    expect(current.$h).not.toBe(t.$h);
    editor.commit();
    expect(editor.read_field(t.$h, '__text')).toBe('aé😀');
    expect(editor.read_field(current.$h, '__text')).toBe('after');
    editor.release_version('1');
    expect(() => editor.read_field(t.$h, '__text')).toThrow();
    expect(editor.read_field(current.$h, '__text')).toBe('after');
  } finally {
    editor.free();
  }
  expect(node.debug_live_editors()).toBe(0);
});

test('host argument getters can reenter before the session lease and caught calls preserve it', () => {
  const editor = new node.EditorHandle({ namespace: 'host', nodes: [] });
  const index = node.EditorHandle.api_index();
  const create = index.indexOf('lexical.$createTextNode');
  try {
    editor.begin_update([], false);
    let nested: { $h: number } | undefined;
    const args = {
      get args() {
        nested = editor.call(create, { args: ['nested'] });
        return ['outer'];
      },
    };
    const outer = editor.call(create, args);
    if (nested === undefined)
      throw new Error('argument getter did not reenter');
    expect(editor.read_field(nested.$h, '__text')).toBe('nested');
    expect(editor.read_field(outer.$h, '__text')).toBe('outer');
    expect(() => editor.call(0xffffffff, { args: [] })).toThrow(
      'unknown API id'
    );
    expect(editor.read_field(outer.$h, '__text')).toBe('outer');
    editor.discard_update();
    expect(() => editor.read_field(outer.$h, '__text')).toThrow();
    editor.begin_update([], false);
    editor.commit();
  } finally {
    editor.free();
  }
});

test('host constructors and postcard decoding reject unsupported or malformed input', () => {
  expect(
    () =>
      new node.EditorHandle({ namespace: 'host', nodes: [{ type: 'custom' }] })
  ).toThrow('needs a foreign registration');
  expect(() => decodeHostPacket(new Uint8Array([2]))).toThrow(
    'unsupported host packet version'
  );
  expect(() =>
    decodeHostPacket(new Uint8Array([255, 255, 255, 255, 31]))
  ).toThrow('invalid postcard u32');
  expect(() => decodeHostPacket(new Uint8Array([1, 0, 0, 1]))).toThrow(
    'truncated postcard data'
  );
  expect(() => decodeHostPacket(new Uint8Array([1, 0, 0, 0, 0]))).toThrow(
    'trailing postcard bytes'
  );
  expect(() => decodeHostPacket(new Uint8Array([1, 0, 0, 1, 255]))).toThrow();
  expect(node.debug_live_editors()).toBe(0);
});

test('no-op versions and subtree removals preserve native mutations without dead records', () => {
  node.reset_key_counter();
  const editor = new node.EditorHandle({ namespace: 'host', nodes: [] });
  const index = node.EditorHandle.api_index();
  const getRoot = index.indexOf('lexical.$getRoot');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const text = index.indexOf('lexical.$createTextNode');
  const append = index.indexOf('LexicalNode.append');
  const remove = index.indexOf('LexicalNode.remove');
  const format = index.indexOf('LexicalNode.setFormat');
  const select = index.indexOf('LexicalNode.select');
  try {
    editor.begin_update([], false);
    const empty = decodeHostPacket(editor.commit());
    expect(empty.words).toEqual([1, 0, 0, 0xffffffff, 0]);
    expect(JSON.parse(empty.metadata_json)).toMatchObject({
      version: 1,
      records: [],
      mutations: [],
      selection: null,
      tags: [],
    });
    editor.begin_update([], false);
    const root = editor.call(getRoot, { args: [] });
    const p = editor.call(paragraph, { args: [] });
    const t = editor.call(text, { args: ['aé😀'] });
    editor.call(append, { this: p, args: [t] });
    editor.call(append, { this: root, args: [p] });
    editor.call(format, { this: t, args: [3] });
    editor.call(select, { this: t, args: [0, 4] });
    const inserted = JSON.parse(
      decodeHostPacket(editor.commit()).metadata_json
    );
    expect(inserted.version).toBe(2);
    expect(inserted.records).toContainEqual({
      __key: '2',
      __type: 'text',
      __parent: '1',
      __prev: null,
      __next: null,
      __text: 'aé😀',
      __format: 3,
      __style: '',
      __mode: 0,
      __detail: 0,
    });
    expect(inserted.selection).toEqual({
      type: 'range',
      anchor: { key: '2', offset: 0, type: 'text' },
      focus: { key: '2', offset: 4, type: 'text' },
      format: 0,
      style: '',
    });
    editor.begin_update([], false);
    editor.call(remove, { this: p, args: [] });
    const removed = JSON.parse(decodeHostPacket(editor.commit()).metadata_json);
    expect(removed.version).toBe(3);
    // S1 §8.7 normal mutations come from dirty sets; the clean descendant
    // disappears through the structural diff, without an invented mutation.
    expect(removed.mutations).toEqual([
      { key: '1', mutation: 'destroyed' },
      { key: 'root', mutation: 'updated' },
    ]);
    expect(removed.records).toHaveLength(1);
    expect(removed.records[0]).toMatchObject({
      __key: 'root',
      __size: 0,
      __first: null,
      __last: null,
    });
  } finally {
    editor.free();
  }
});

test('real JS transforms reenter the current transaction and restore it after another editor', () => {
  const editor = new node.EditorHandle({ namespace: 'first', nodes: [] });
  const other = new node.EditorHandle({ namespace: 'second', nodes: [] });
  const index = node.EditorHandle.api_index();
  const create = index.indexOf('lexical.$createTextNode');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const root = index.indexOf('lexical.$getRoot');
  const append = index.indexOf('LexicalNode.append');
  const set = index.indexOf('LexicalNode.setTextContent');
  const after = index.indexOf('LexicalNode.insertAfter');
  const format = index.indexOf('LexicalNode.setFormat');
  const latest = index.indexOf('LexicalNode.getLatest');
  other.register_transform('text', (current: { $h: number }) => {
    expect(() => editor.call(create, { args: ['wrong editor'] })).toThrow(
      'callback belongs to another editor'
    );
    expect(other.read_field(current.$h, '__text')).toBe('other');
  });
  let calls = 0;
  let initial: { $h: number } | undefined;
  let nested: { $h: number } | undefined;
  const registration = editor.register_transform(
    'text',
    (current: { $h: number }) => {
      calls++;
      expect(editor.call(latest, { this: current, args: [] }).$h).toBe(
        current.$h
      );
      if (editor.read_field(current.$h, '__text') !== 'initial') return;
      expect(current.$h).toBe(initial?.$h);
      expect(() => editor.call(0xffffffff, { args: [] })).toThrow(
        'unknown API id'
      );
      editor.call(set, { this: current, args: ['done'] });
      const side = editor.call(create, { args: ['side'] });
      editor.call(format, { this: side, args: [1] });
      editor.call(after, { this: current, args: [side] });
      other.begin_update([], true);
      nested = other.call(create, { args: ['other'] });
      const p = other.call(paragraph, { args: [] });
      other.call(append, { this: p, args: [nested] });
      other.call(append, { this: other.call(root, { args: [] }), args: [p] });
      other.commit();
      expect(editor.read_field(current.$h, '__text')).toBe('done');
    }
  );
  try {
    editor.begin_update([], false);
    initial = editor.call(create, { args: ['initial'] });
    const p = editor.call(paragraph, { args: [] });
    editor.call(append, { this: p, args: [initial] });
    editor.call(append, { this: editor.call(root, { args: [] }), args: [p] });
    const packet = decodeHostPacket(editor.commit());
    expect(calls).toBeGreaterThan(0);
    expect(JSON.parse(packet.metadata_json).records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ __text: 'done' }),
        expect.objectContaining({ __text: 'side', __format: 1 }),
      ])
    );
    if (nested === undefined) throw new Error('second editor did not run');
    expect(other.read_field(nested.$h, '__text')).toBe('other');
    editor.unregister(registration);
    editor.unregister(registration);
    expect(() => editor.call(create, { args: ['outside'] })).toThrow();
  } finally {
    editor.free();
    other.free();
  }
  expect(node.debug_live_editors()).toBe(0);
});

test('a thrown JS transform rolls back commit and releases the scoped callback', () => {
  const editor = new node.EditorHandle({ namespace: 'throw', nodes: [] });
  const index = node.EditorHandle.api_index();
  const text = index.indexOf('lexical.$createTextNode');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const append = index.indexOf('LexicalNode.append');
  const root = index.indexOf('lexical.$getRoot');
  const registration = editor.register_transform('text', () => {
    throw new Error('transform failed');
  });
  try {
    editor.begin_update([], false);
    const t = editor.call(text, { args: ['rollback'] });
    const p = editor.call(paragraph, { args: [] });
    editor.call(append, { this: p, args: [t] });
    editor.call(append, { this: editor.call(root, { args: [] }), args: [p] });
    expect(() => editor.commit()).toThrow('transform failed');
    expect(() => editor.read_field(t.$h, '__text')).toThrow();
    editor.unregister(registration);
    editor.begin_update([], true);
    const packet = decodeHostPacket(editor.commit());
    expect(JSON.parse(packet.metadata_json).records).toEqual([]);
  } finally {
    editor.free();
  }
});

test('reentrant JS transforms use the model fixpoint guard and exact invariant', () => {
  const editor = new node.EditorHandle({ namespace: 'fixpoint', nodes: [] });
  const index = node.EditorHandle.api_index();
  const text = index.indexOf('lexical.$createTextNode');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const append = index.indexOf('LexicalNode.append');
  const root = index.indexOf('lexical.$getRoot');
  const set = index.indexOf('LexicalNode.setTextContent');
  let calls = 0;
  const registration = editor.register_transform(
    'text',
    (current: { $h: number }) => {
      calls++;
      const value = editor.read_field(current.$h, '__text');
      editor.call(set, { this: current, args: [value === 'a' ? 'b' : 'a'] });
    }
  );
  try {
    editor.begin_update([], false);
    const t = editor.call(text, { args: ['a'] });
    const p = editor.call(paragraph, { args: [] });
    editor.call(append, { this: p, args: [t] });
    editor.call(append, { this: editor.call(root, { args: [] }), args: [p] });
    expect(() => editor.commit()).toThrow(
      'One or more transforms are endlessly triggering additional transforms. May have encountered infinite recursion caused by transforms that have their preconditions too lose and/or conflict with each other.'
    );
    expect(calls).toBe(101);
    editor.unregister(registration);
    editor.begin_update([], true);
    editor.commit();
  } finally {
    editor.free();
  }
});

test('callback registration dirties existing nodes and preserves the current transform snapshot', () => {
  const editor = new node.EditorHandle({
    namespace: 'registration',
    nodes: [],
  });
  const index = node.EditorHandle.api_index();
  const create = index.indexOf('lexical.$createTextNode');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const append = index.indexOf('LexicalNode.append');
  const root = index.indexOf('lexical.$getRoot');
  const set = index.indexOf('LexicalNode.setTextContent');
  const calls: string[] = [];
  let registration = -1;
  const later = (current: { $h: number }) => {
    calls.push(editor.read_field(current.$h, '__text'));
  };
  let replaced = false;
  const transform = () => {
    calls.push('first');
    if (replaced) return;
    replaced = true;
    editor.unregister(registration);
    editor.register_transform('text', later);
  };
  registration = editor.register_transform('text', transform);
  expect(editor.register_transform('text', transform)).toBe(registration);
  try {
    editor.begin_update([], false);
    const t = editor.call(create, { args: ['before'] });
    const p = editor.call(paragraph, { args: [] });
    editor.call(append, { this: p, args: [t] });
    editor.call(append, { this: editor.call(root, { args: [] }), args: [p] });
    editor.commit();
    expect(calls).toEqual(['first', 'first']);
    editor.unregister(registration);
    editor.begin_update([], true);
    editor.call(set, { this: t, args: ['after'] });
    editor.commit();
    expect(calls).toEqual(['first', 'first', 'after']);
  } finally {
    editor.free();
  }
});

test('callback errors preserve opaque thrown identity without reading message getters', () => {
  const editor = new node.EditorHandle({
    namespace: 'opaque error',
    nodes: [],
  });
  const index = node.EditorHandle.api_index();
  const create = index.indexOf('lexical.$createTextNode');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const append = index.indexOf('LexicalNode.append');
  const root = index.indexOf('lexical.$getRoot');
  let messageReads = 0;
  const thrown = Object.defineProperty({}, 'message', {
    get() {
      messageReads++;
      throw new Error('must not inspect');
    },
  });
  const registration = editor.register_transform('text', () => {
    throw thrown;
  });
  try {
    editor.begin_update([], false);
    const t = editor.call(create, { args: ['rollback'] });
    const p = editor.call(paragraph, { args: [] });
    editor.call(append, { this: p, args: [t] });
    editor.call(append, { this: editor.call(root, { args: [] }), args: [p] });
    let caught = false;
    try {
      editor.commit();
    } catch (error) {
      caught = true;
      expect(error).toBe(thrown);
    }
    expect(caught).toBe(true);
    expect(messageReads).toBe(0);
    editor.unregister(registration);
    editor.register_transform('text', () => {
      throw undefined;
    });
    editor.begin_update([], false);
    const second = editor.call(create, { args: ['undefined'] });
    const secondP = editor.call(paragraph, { args: [] });
    editor.call(append, { this: secondP, args: [second] });
    editor.call(append, {
      this: editor.call(root, { args: [] }),
      args: [secondP],
    });
    caught = false;
    try {
      editor.commit();
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
  } finally {
    editor.free();
  }
});

test('transform registration counts the function reference and returned registration id', () => {
  const editor = new node.EditorHandle({
    namespace: 'registration bytes',
    nodes: [],
  });
  try {
    node.debug_reset_counters();
    editor.register_transform('text', () => {});
    // receiver4 + name8 + function-reference4 + returned-id4 + observer8.
    expect(node.debug_boundary_bytes()).toBe(28);
    // Function insertion calls the actual exported externref allocator too.
    expect(node.debug_crossings()).toBe(4);
  } finally {
    editor.free();
  }
});

test('registration dirties committed text and identical function registrations invoke once', () => {
  const editor = new node.EditorHandle({
    namespace: 'dirty registration',
    nodes: [],
  });
  const index = node.EditorHandle.api_index();
  const create = index.indexOf('lexical.$createTextNode');
  const paragraph = index.indexOf('lexical.$createParagraphNode');
  const append = index.indexOf('LexicalNode.append');
  const root = index.indexOf('lexical.$getRoot');
  const format = index.indexOf('LexicalNode.setFormat');
  let calls = 0;
  const transform = (current: { $h: number }) => {
    calls++;
    expect(editor.read_field(current.$h, '__text')).toBe('a');
  };
  try {
    editor.begin_update([], false);
    const t = editor.call(create, { args: ['a'] });
    const p = editor.call(paragraph, { args: [] });
    editor.call(append, { this: p, args: [t] });
    editor.call(append, { this: editor.call(root, { args: [] }), args: [p] });
    editor.commit();
    const registration = editor.register_transform('text', transform);
    expect(editor.register_transform('text', transform)).toBe(registration);
    editor.begin_update([], false);
    editor.commit();
    expect(calls).toBe(1);
    editor.unregister(registration);
    editor.unregister(registration);
    editor.begin_update([], false);
    editor.call(format, { this: t, args: [1] });
    editor.commit();
    expect(calls).toBe(1);
  } finally {
    editor.free();
  }
});
