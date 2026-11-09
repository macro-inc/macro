import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('canMergeWith preserves node identity, extra arguments and native super', () => {
  const hook = foreignHookIndex().indexOf('canMergeWith');
  const backend = new ConformanceBackend({
    namespace: 'canMergeWith node predicate',
    nodes: [
      {
        type: 'node-predicate',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let other: unknown;
  let calls = 0;
  try {
    backend.installForeign('node-predicate', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(handles.node(message.args[0])).toBe(handles.node(other));
      expect(message.args.slice(1)).toEqual(['extra']);
      expect(
        backend.callNative(
          'LexicalNode.canMergeWith',
          message.args,
          message.node
        )
      ).toBe(false);
      return true;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'node-predicate',
      {},
    ]);
    other = backend.call('lexical.$createParagraphNode', []);
    handles.node(other);
    expect(
      backend.call('LexicalNode.canMergeWith', [other, 'extra'], node)
    ).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('canReplaceWith preserves node identity, extra arguments and native super', () => {
  const hook = foreignHookIndex().indexOf('canReplaceWith');
  const backend = new ConformanceBackend({
    namespace: 'canReplaceWith node predicate',
    nodes: [
      {
        type: 'node-predicate',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let other: unknown;
  let calls = 0;
  try {
    backend.installForeign('node-predicate', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(handles.node(message.args[0])).toBe(handles.node(other));
      expect(message.args.slice(1)).toEqual(['extra']);
      expect(
        backend.callNative(
          'LexicalNode.canReplaceWith',
          message.args,
          message.node
        )
      ).toBe(true);
      return false;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'node-predicate',
      {},
    ]);
    other = backend.call('lexical.$createParagraphNode', []);
    handles.node(other);
    expect(
      backend.call('LexicalNode.canReplaceWith', [other, 'extra'], node)
    ).toBe(false);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('canInsertAfter preserves node identity, extra arguments and native super', () => {
  const hook = foreignHookIndex().indexOf('canInsertAfter');
  const backend = new ConformanceBackend({
    namespace: 'canInsertAfter node predicate',
    nodes: [
      {
        type: 'node-predicate',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let other: unknown;
  let calls = 0;
  try {
    backend.installForeign('node-predicate', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(handles.node(message.args[0])).toBe(handles.node(other));
      expect(message.args.slice(1)).toEqual(['extra']);
      expect(
        backend.callNative(
          'LexicalNode.canInsertAfter',
          message.args,
          message.node
        )
      ).toBe(true);
      return false;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'node-predicate',
      {},
    ]);
    other = backend.call('lexical.$createParagraphNode', []);
    handles.node(other);
    expect(
      backend.call('LexicalNode.canInsertAfter', [other, 'extra'], node)
    ).toBe(false);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('native list append captures a node predicate argument and stops after an opaque throw', () => {
  const hook = foreignHookIndex().indexOf('canMergeWith');
  const backend = new ConformanceBackend({
    namespace: 'list merge predicate',
    nodes: [
      { type: 'listitem' },
      {
        type: 'checked-listitem',
        kind: 'Element',
        extends: 'listitem',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  const opaque = {};
  let other: unknown;
  let calls = 0;
  let fail = true;
  try {
    backend.installForeign('checked-listitem', (message) => {
      calls++;
      expect(message.args).toHaveLength(1);
      expect(handles.node(message.args[0])).toBe(handles.node(other));
      expect(
        backend.callNative(
          'LexicalNode.canMergeWith',
          message.args,
          message.node
        )
      ).toBe(true);
      if (fail) throw opaque;
      return true;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'checked-listitem',
      { value: 1 },
    ]);
    other = backend.call('lexical.$createParagraphNode', []);
    handles.node(other);
    const text = backend.call('lexical.$createTextNode', ['word']);
    backend.call('LexicalNode.append', [text], other);
    try {
      backend.call('LexicalNode.append', [other], node);
      throw new Error('append must throw');
    } catch (error) {
      expect(error).toBe(opaque);
    }
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getChildrenSize', [], node)).toBe(0);
    expect(backend.call('LexicalNode.getChildrenSize', [], other)).toBe(1);
    fail = false;
    backend.call('LexicalNode.append', [other], node);
    expect(calls).toBe(2);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('word');
    expect(backend.call('LexicalNode.getChildrenSize', [], other)).toBe(0);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('a package type with foreign metadata keeps JS behavior and native metadata rejects unknown types', () => {
  const hook = foreignHookIndex().indexOf('canMergeWith');
  const backend = new ConformanceBackend({
    namespace: 'foreign package registration',
    nodes: [
      {
        type: 'listitem',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('listitem', () => {
      calls++;
      return true;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'listitem',
      {},
    ]);
    const other = backend.call('lexical.$createParagraphNode', []);
    expect(backend.call('LexicalNode.canMergeWith', [other], node)).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
  expect(
    () =>
      new ConformanceBackend({
        namespace: 'unknown native',
        nodes: [{ type: 'missing-native' }],
      })
  ).toThrow(/unknown native node type/);
  expect(
    () =>
      new ConformanceBackend({
        namespace: 'invalid native',
        nodes: [{ type: 'listitem', overrides: '1' }],
      })
  ).toThrow(/native registration cannot have foreign behavior/);
});
