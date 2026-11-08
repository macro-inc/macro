import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('native child removal calls canBeEmpty and removes an empty foreign parent', () => {
  const hook = foreignHookIndex().indexOf('canBeEmpty');
  const backend = new ConformanceBackend({
    namespace: 'empty parent predicate',
    nodes: [
      {
        type: 'nonempty-parent',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let parent: unknown;
  let calls = 0;
  try {
    backend.installForeign('nonempty-parent', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(handles.node(message.node)).toBe(handles.node(parent));
      expect(
        backend.call('LexicalNode.getChildrenSize', [], message.node)
      ).toBe(0);
      expect(
        backend.callNative('LexicalNode.canBeEmpty', [], message.node)
      ).toBe(true);
      return 0;
    });
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    parent = backend.call('conformance.createForeignNode', [
      'nonempty-parent',
      {},
    ]);
    handles.node(parent);
    const text = backend.call('lexical.$createTextNode', ['child']);
    backend.call('LexicalNode.append', [text], parent);
    backend.call('LexicalNode.append', [parent], root);
    backend.call('LexicalNode.remove', [], text);
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getChildren', [], root)).toEqual([]);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('a throwing canBeEmpty preserves the detached child but stops later parent removal', () => {
  const hook = foreignHookIndex().indexOf('canBeEmpty');
  const backend = new ConformanceBackend({
    namespace: 'empty parent failure',
    nodes: [
      {
        type: 'checked-parent',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  const opaque = {};
  let calls = 0;
  try {
    backend.installForeign('checked-parent', (message) => {
      calls++;
      expect(
        backend.call('LexicalNode.getChildrenSize', [], message.node)
      ).toBe(0);
      throw opaque;
    });
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const parent = backend.call('conformance.createForeignNode', [
      'checked-parent',
      {},
    ]);
    handles.node(parent);
    const text = backend.call('lexical.$createTextNode', ['child']);
    backend.call('LexicalNode.append', [text], parent);
    backend.call('LexicalNode.append', [parent], root);
    try {
      backend.call('LexicalNode.remove', [], text);
      throw new Error('parent predicate must throw');
    } catch (error) {
      expect(error).toBe(opaque);
    }
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getParent', [], text)).toBeNull();
    expect(backend.call('LexicalNode.getChildrenSize', [], parent)).toBe(0);
    expect(backend.call('LexicalNode.getChildrenSize', [], root)).toBe(1);
    expect(
      handles.node(backend.call('LexicalNode.getFirstChild', [], root))
    ).toBe(handles.node(parent));
    backend.call('LexicalNode.remove', [], parent);
    expect(backend.call('LexicalNode.getChildrenSize', [], root)).toBe(0);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
