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
