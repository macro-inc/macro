import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('foreign replace returns the native result through the shared node identity cache', () => {
  const hook = foreignHookIndex().indexOf('replace');
  const backend = new ConformanceBackend({
    namespace: 'foreign replace',
    nodes: [
      {
        type: 'custom-replace',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let calls = 0;
  try {
    backend.installForeign('custom-replace', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args[1]).toBe(false);
      return backend.callNative(
        'LexicalNode.replace',
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-replace',
      {},
    ]);
    const replacement = backend.call('lexical.$createTextNode', [
      'replacement',
    ]);
    const identity = handles.node(replacement);
    const p = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [node], p);
    const result = backend.call(
      'LexicalNode.replace',
      [replacement, false],
      node
    );
    expect(handles.node(result)).toBe(identity);
    expect(backend.call('LexicalNode.getTextContent', [], p)).toBe(
      'replacement'
    );
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign insertAfter may return a different newly created node and owns the insertion', () => {
  const hook = foreignHookIndex().indexOf('insertAfter');
  const backend = new ConformanceBackend({
    namespace: 'foreign insert after',
    nodes: [
      {
        type: 'custom-after',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let actual: unknown;
  let calls = 0;
  try {
    backend.installForeign('custom-after', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args[1]).toBe(false);
      actual = backend.call('lexical.$createTextNode', ['actual']);
      handles.node(actual);
      return backend.callNative(
        'LexicalNode.insertAfter',
        [actual, false],
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-after',
      {},
    ]);
    const requested = backend.call('lexical.$createTextNode', ['requested']);
    const p = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.setTextContent', ['source'], node);
    backend.call('LexicalNode.append', [node], p);
    const result = backend.call(
      'LexicalNode.insertAfter',
      [requested, false],
      node
    );
    expect(handles.node(result)).toBe(handles.node(actual));
    expect(backend.call('LexicalNode.getTextContent', [], p)).toBe(
      'sourceactual'
    );
    expect(backend.call('LexicalNode.getParent', [], requested)).toBe(null);
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign insertBefore preserves opaque errors and restores its mutable callback scope', () => {
  const hook = foreignHookIndex().indexOf('insertBefore');
  const backend = new ConformanceBackend({
    namespace: 'foreign insert before',
    nodes: [
      {
        type: 'custom-before',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  const failure = { opaque: 'node result' };
  let calls = 0;
  try {
    backend.installForeign('custom-before', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      if (calls === 1) throw failure;
      return backend.callNative(
        'LexicalNode.insertBefore',
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-before',
      {},
    ]);
    const before = backend.call('lexical.$createTextNode', ['before']);
    const identity = handles.node(before);
    const p = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [node], p);
    let thrown: unknown;
    try {
      backend.call('LexicalNode.insertBefore', [before, true], node);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);
    expect(
      handles.node(
        backend.call('LexicalNode.insertBefore', [before, true], node)
      )
    ).toBe(identity);
    expect(calls).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign createParentElementNode validates return values before returning model keys', () => {
  const hook = foreignHookIndex().indexOf('createParentElementNode');
  const backend = new ConformanceBackend({
    namespace: 'foreign create parent',
    nodes: [
      {
        type: 'custom-parent',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let calls = 0;
  let parent: unknown;
  try {
    backend.installForeign('custom-parent', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      if (calls === 1) return null;
      if (calls === 2) return { $h: 999999 };
      parent = backend.call('lexical.$createParagraphNode', []);
      handles.node(parent);
      return parent;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-parent',
      {},
    ]);
    expect(() =>
      backend.call('LexicalNode.createParentElementNode', [], node)
    ).toThrow('foreign hook must return a node handle');
    expect(() =>
      backend.call('LexicalNode.createParentElementNode', [], node)
    ).toThrow('unknown handle');
    const result = backend.call(
      'LexicalNode.createParentElementNode',
      [],
      node
    );
    expect(handles.node(result)).toBe(handles.node(parent));
    expect(calls).toBe(3);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
