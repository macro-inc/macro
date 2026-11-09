import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('model paragraph insertion passes the existing selection into a foreign insertNewAfter', () => {
  const hook = foreignHookIndex().indexOf('insertNewAfter');
  const backend = new ConformanceBackend({
    namespace: 'foreign new paragraph',
    nodes: [
      {
        type: 'custom-paragraph',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let calls = 0;
  try {
    backend.installForeign('custom-paragraph', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args[0]).toEqual(
        backend.call('lexical.$getSelection', [])
      );
      expect(message.args[1]).toBe(false);
      const result = backend.callNative(
        'LexicalNode.insertNewAfter',
        message.args,
        message.node
      );
      handles.node(result);
      return result;
    });
    backend.beginUpdate([], false);
    const block = backend.call('conformance.createForeignNode', [
      'custom-paragraph',
      {},
    ]);
    const text = backend.call('lexical.$createTextNode', ['text']);
    backend.call('LexicalNode.append', [text], block);
    backend.call(
      'LexicalNode.append',
      [block],
      backend.call('lexical.$getRoot', [])
    );
    const selection = backend.call('LexicalNode.select', [4, 4], text);
    backend.call('Selection.insertParagraph', [], selection);
    expect(calls).toBe(1);
    expect(
      backend.call(
        'LexicalNode.getChildrenSize',
        [],
        backend.call('lexical.$getRoot', [])
      )
    ).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign insertNewAfter accepts null but rejects undefined and restores its callback scope', () => {
  const hook = foreignHookIndex().indexOf('insertNewAfter');
  const backend = new ConformanceBackend({
    namespace: 'foreign nullable paragraph',
    nodes: [
      {
        type: 'custom-nullable',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-nullable', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(backend.call('Selection.isCollapsed', [], message.args[0])).toBe(
        true
      );
      if (calls === 1) return undefined;
      return null;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-nullable',
      {},
    ]);
    const selection = backend.call('lexical.$createRangeSelection', []);
    expect(() =>
      backend.call('LexicalNode.insertNewAfter', [selection, false], node)
    ).toThrow('foreign hook must return a node handle');
    expect(
      backend.call('LexicalNode.insertNewAfter', [selection, false], node)
    ).toBe(null);
    expect(calls).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('model backspace passes the current selection to a foreign collapseAtStart and uses JS truthiness', () => {
  const hook = foreignHookIndex().indexOf('collapseAtStart');
  const backend = new ConformanceBackend({
    namespace: 'foreign collapse',
    nodes: [
      {
        type: 'custom-collapse',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-collapse', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([backend.call('lexical.$getSelection', [])]);
      expect(backend.call('Selection.isCollapsed', [], message.args[0])).toBe(
        true
      );
      return { handled: true };
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-collapse',
      {},
    ]);
    const text = backend.call('lexical.$createTextNode', ['text']);
    backend.call('LexicalNode.append', [text], node);
    backend.call(
      'LexicalNode.append',
      [node],
      backend.call('lexical.$getRoot', [])
    );
    const selection = backend.call('LexicalNode.select', [0, 0], text);
    backend.call('Selection.deleteCharacter', [true], selection);
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('text');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign static transforms run from the model dirty loop and can reenter native setters', () => {
  const hook = foreignHookIndex().indexOf('transform');
  const backend = new ConformanceBackend({
    namespace: 'foreign static transform',
    nodes: [
      {
        type: 'custom-transform',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-transform', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      if (
        backend.call('LexicalNode.getTextContent', [], message.node) === 'lower'
      )
        backend.call('LexicalNode.setTextContent', ['UPPER'], message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-transform',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['lower'], node);
    const p = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [node], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.flush();
    expect(calls).toBeGreaterThan(0);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('UPPER');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('replacement child transfer uses virtual splice with the original selection at the old element', () => {
  const hook = foreignHookIndex().indexOf('splice');
  const append = foreignHookIndex().indexOf('append');
  const backend = new ConformanceBackend({
    namespace: 'foreign replacement selection',
    nodes: [
      {
        type: 'selection-receiver',
        kind: 'Element',
        extends: 'paragraph',
        overrides: ((1n << BigInt(hook)) | (1n << BigInt(append))).toString(),
      },
    ],
  });
  let calls = 0;
  let oldSelection: unknown;
  let oldKey: unknown;
  try {
    backend.installForeign('selection-receiver', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(backend.call('lexical.$getSelection', [])).toEqual(oldSelection);
      expect(message.args).toHaveLength(3);
      const anchor = backend.call(
        'get:anchor',
        [],
        backend.call('lexical.$getSelection', [])
      );
      expect(backend.call('get:key', [], anchor)).toEqual(oldKey);
      expect(backend.call('get:offset', [], anchor)).toBe(0);
      expect(backend.call('get:type', [], anchor)).toBe('element');
      return backend.callNative(
        'LexicalNode.splice',
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const original = backend.call('lexical.$createParagraphNode', []);
    oldKey = backend.call('LexicalNode.getKey', [], original);
    const text = backend.call('lexical.$createTextNode', ['text']);
    backend.call('LexicalNode.append', [text], original);
    backend.call(
      'LexicalNode.append',
      [original],
      backend.call('lexical.$getRoot', [])
    );
    const selection = backend.call('LexicalNode.select', [1, 2], text);
    oldSelection = backend.call('lexical.$getSelection', []);
    const replacement = backend.call('conformance.createForeignNode', [
      'selection-receiver',
      {},
    ]);
    backend.call('LexicalNode.replace', [replacement, true], original);
    expect(calls).toBe(1);
    const oldAnchor = backend.call('get:anchor', [], selection);
    expect(backend.call('get:key', [], oldAnchor)).toEqual(oldKey);
    expect(backend.call('get:offset', [], oldAnchor)).toBe(0);
    const current = backend.call('lexical.$getSelection', []);
    expect(current).not.toEqual(oldSelection);
    const anchor = backend.call('get:anchor', [], current);
    const focus = backend.call('get:focus', [], current);
    expect(backend.call('get:key', [], anchor)).toEqual(
      backend.call('LexicalNode.getKey', [], text)
    );
    expect(backend.call('get:offset', [], anchor)).toBe(1);
    expect(backend.call('get:offset', [], focus)).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
