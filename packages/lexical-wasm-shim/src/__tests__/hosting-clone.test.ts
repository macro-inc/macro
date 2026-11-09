import { expect, test } from 'vitest';
import {
  ConformanceBackend,
  foreignHookIndex,
  isCloneNode,
} from '../backend/conformance';
import { NodeHandles } from '../handles';

test('a writable clone initializes staged fields while reading the original through an owned peer', () => {
  const hook = foreignHookIndex().indexOf('afterCloneFrom');
  const backend = new ConformanceBackend({
    namespace: 'writable clone',
    nodes: [
      {
        type: 'cloned-element',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id, key) => ({ id, key }));
  let original: unknown;
  let calls = 0;
  try {
    backend.installForeign('cloned-element', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      if (!isCloneNode(message.node)) throw new Error('expected staged clone');
      expect(message.node.$clone.key).toBe(handles.node(original).key);
      expect(message.node.$clone.type).toBe('cloned-element');
      expect(message.node.$clone.fields).toEqual({ marker: 'original' });
      expect(handles.node(message.args[0])).toBe(handles.node(original));
      expect(
        backend.call('LexicalNode.exportJSON', [], message.args[0])
      ).toMatchObject({ marker: 'original', indent: 0 });
      expect(() =>
        backend.call('LexicalNode.setIndent', [9], message.args[0])
      ).toThrow(/read-only/);
      expect(
        backend.call(
          'LexicalNode.getChildrenSize',
          [],
          backend.call('lexical.$getRoot', [])
        )
      ).toBe(1);
      return { ...message.node.$clone.fields, marker: 'cloned' };
    });
    backend.beginUpdate([], false);
    original = backend.call('conformance.createForeignNode', [
      'cloned-element',
      { marker: 'original' },
    ]);
    const before = handles.node(original);
    backend.call(
      'LexicalNode.append',
      [original],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    expect(calls).toBe(0);
    backend.beginUpdate([], false);
    const writable = backend.call('LexicalNode.getWritable', [], original);
    expect(calls).toBe(1);
    expect(handles.node(writable)).not.toBe(before);
    backend.call('LexicalNode.setIndent', [3], writable);
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.exportJSON', [], writable)).toMatchObject({
      marker: 'cloned',
      indent: 3,
    });
    expect(backend.readField(before.id, '__indent')).toBe(0);
    backend.commit();
    expect(backend.readField(before.id, '__indent')).toBe(0);
  } finally {
    backend.dispose();
  }
});

test('copyNode gives its staged clone a fresh key and omits child and parent links', () => {
  const hook = foreignHookIndex().indexOf('afterCloneFrom');
  const backend = new ConformanceBackend({
    namespace: 'detached staged copy',
    nodes: [
      {
        type: 'copied-element',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id, key) => ({ id, key }));
  let original: unknown;
  let stagedKey: string | undefined;
  let calls = 0;
  try {
    backend.installForeign('copied-element', (message) => {
      calls++;
      if (!isCloneNode(message.node)) throw new Error('expected staged clone');
      stagedKey = message.node.$clone.key;
      expect(stagedKey).not.toBe(handles.node(original).key);
      expect(handles.node(message.args[0])).toBe(handles.node(original));
      expect(
        backend.call('LexicalNode.getChildrenSize', [], message.args[0])
      ).toBe(1);
      return { ...message.node.$clone.fields, marker: 'copied' };
    });
    backend.beginUpdate([], false);
    original = backend.call('conformance.createForeignNode', [
      'copied-element',
      { marker: 'source' },
    ]);
    handles.node(original);
    backend.call(
      'LexicalNode.append',
      [backend.call('lexical.$createTextNode', ['child'])],
      original
    );
    backend.call(
      'LexicalNode.append',
      [original],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    backend.beginUpdate([], false);
    const copy = backend.call('lexical.$copyNode', [original]);
    expect(calls).toBe(1);
    expect(handles.node(copy).key).toBe(stagedKey);
    expect(backend.call('LexicalNode.getChildrenSize', [], copy)).toBe(0);
    expect(backend.call('LexicalNode.getParent', [], copy)).toBeNull();
    expect(backend.call('LexicalNode.exportJSON', [], copy)).toMatchObject({
      marker: 'copied',
    });
    expect(backend.call('LexicalNode.getChildrenSize', [], original)).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('an opaque clone failure leaves the original installed and allows a later retry', () => {
  const hook = foreignHookIndex().indexOf('afterCloneFrom');
  const backend = new ConformanceBackend({
    namespace: 'clone error recovery',
    nodes: [
      {
        type: 'checked-clone',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let fail = true;
  let calls = 0;
  try {
    backend.installForeign('checked-clone', (message) => {
      calls++;
      if (!isCloneNode(message.node)) throw new Error('expected staged clone');
      expect(backend.call('LexicalNode.getIndent', [], message.args[0])).toBe(
        0
      );
      if (fail) throw undefined;
      return { ...message.node.$clone.fields, marker: 'recovered' };
    });
    backend.beginUpdate([], false);
    const original = backend.call('conformance.createForeignNode', [
      'checked-clone',
      { marker: 'original' },
    ]);
    backend.call(
      'LexicalNode.append',
      [original],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    backend.beginUpdate([], false);
    try {
      backend.call('LexicalNode.setIndent', [4], original);
      throw new Error('clone must throw');
    } catch (error) {
      expect(error).toBeUndefined();
    }
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.exportJSON', [], original)).toMatchObject({
      marker: 'original',
      indent: 0,
    });
    fail = false;
    backend.call('LexicalNode.setIndent', [2], original);
    expect(calls).toBe(2);
    expect(backend.call('LexicalNode.exportJSON', [], original)).toMatchObject({
      marker: 'recovered',
      indent: 2,
    });
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('clone result getters stay inside the owned read scope and preserve opaque conversion errors', () => {
  const hook = foreignHookIndex().indexOf('afterCloneFrom');
  const backend = new ConformanceBackend({
    namespace: 'clone conversion',
    nodes: [
      {
        type: 'getter-clone',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const opaque = {};
  let fail = true;
  let reads = 0;
  try {
    backend.installForeign('getter-clone', (message) => {
      if (!isCloneNode(message.node)) throw new Error('expected staged clone');
      return Object.defineProperty({}, 'marker', {
        enumerable: true,
        get() {
          reads++;
          expect(
            backend.call(
              'LexicalNode.getChildrenSize',
              [],
              backend.call('lexical.$getRoot', [])
            )
          ).toBe(1);
          expect(() =>
            backend.call('LexicalNode.setIndent', [7], message.args[0])
          ).toThrow(/read-only/);
          if (fail) throw opaque;
          return 'converted';
        },
      });
    });
    backend.beginUpdate([], false);
    const original = backend.call('conformance.createForeignNode', [
      'getter-clone',
      { marker: 'original' },
    ]);
    backend.call(
      'LexicalNode.append',
      [original],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    backend.beginUpdate([], false);
    try {
      backend.call('LexicalNode.getWritable', [], original);
      throw new Error('conversion must throw');
    } catch (error) {
      expect(error).toBe(opaque);
    }
    expect(reads).toBe(1);
    expect(backend.call('LexicalNode.exportJSON', [], original)).toMatchObject({
      marker: 'original',
    });
    fail = false;
    const writable = backend.call('LexicalNode.getWritable', [], original);
    expect(reads).toBe(2);
    expect(backend.call('LexicalNode.exportJSON', [], writable)).toMatchObject({
      marker: 'converted',
    });
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('malformed native ancestor fields reject before the writable clone is installed', () => {
  const hook = foreignHookIndex().indexOf('afterCloneFrom');
  const backend = new ConformanceBackend({
    namespace: 'clone native decode',
    nodes: [
      { type: 'code' },
      {
        type: 'typed-clone',
        kind: 'Element',
        extends: 'code',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let invalid = true;
  try {
    backend.installForeign('typed-clone', (message) => {
      if (!isCloneNode(message.node)) throw new Error('expected staged clone');
      return { ...message.node.$clone.fields, language: invalid ? 42 : 'rust' };
    });
    backend.beginUpdate([], false);
    const original = backend.call('conformance.createForeignNode', [
      'typed-clone',
      { language: 'js', marker: 'keep' },
    ]);
    backend.call(
      'LexicalNode.append',
      [original],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    backend.beginUpdate([], false);
    expect(() => backend.call('LexicalNode.setIndent', [3], original)).toThrow(
      /string/
    );
    expect(backend.call('LexicalNode.exportJSON', [], original)).toMatchObject({
      language: 'js',
      marker: 'keep',
      indent: 0,
    });
    invalid = false;
    backend.call('LexicalNode.setIndent', [2], original);
    expect(backend.call('LexicalNode.exportJSON', [], original)).toMatchObject({
      language: 'rust',
      marker: 'keep',
      indent: 2,
    });
    backend.commit();
  } finally {
    backend.dispose();
  }
});
