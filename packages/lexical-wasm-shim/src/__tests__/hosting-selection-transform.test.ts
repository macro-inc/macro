import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';

test('selection transforms receive existing previous and next objects and follow a moved focus', () => {
  const hook = foreignHookIndex().indexOf('selectionTransform');
  const backend = new ConformanceBackend({
    namespace: 'foreign selection transform',
    nodes: [
      {
        type: 'selection-text',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const observed: unknown[] = [];
  let first: unknown;
  let secondKey: unknown;
  let committed: unknown = null;
  try {
    backend.installForeign('selection-text', (message) => {
      expect(message.hook).toBe(hook);
      const key = backend.call('LexicalNode.getKey', [], message.node);
      observed.push(key);
      expect(message.args[0]).toEqual(committed);
      expect(message.args[0]).toEqual(
        backend.call('lexical.$getPreviousSelection', [])
      );
      expect(message.args[1]).toEqual(
        backend.call('lexical.$getSelection', [])
      );
      if (
        JSON.stringify(key) ===
        JSON.stringify(backend.call('LexicalNode.getKey', [], first))
      ) {
        const focus = backend.call('get:focus', [], message.args[1]);
        backend.call('Selection.set', [secondKey, 1, 'text'], focus);
      }
    });
    backend.beginUpdate([], false);
    first = backend.call('conformance.createForeignNode', [
      'selection-text',
      {},
    ]);
    const second = backend.call('conformance.createForeignNode', [
      'selection-text',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['first'], first);
    backend.call('LexicalNode.setTextContent', ['second'], second);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [first, second], paragraph);
    backend.call(
      'LexicalNode.append',
      [paragraph],
      backend.call('lexical.$getRoot', [])
    );
    backend.call('LexicalNode.select', [0, 0], first);
    const firstKey = backend.call('LexicalNode.getKey', [], first);
    secondKey = backend.call('LexicalNode.getKey', [], second);
    backend.flush();
    expect(observed).toEqual([firstKey, secondKey]);
    committed = backend.call('lexical.$getSelection', []);
    backend.commit();
    expect(observed).toEqual([firstKey, secondKey]);
    observed.length = 0;
    backend.beginUpdate([], false);
    const current = backend.call('lexical.$getSelection', []);
    expect(current).not.toEqual(committed);
    backend.flush();
    expect(observed).toEqual([firstKey, secondKey]);
    const focus = backend.call('get:focus', [], current);
    expect(backend.call('get:offset', [], focus)).toBe(1);
    backend.commit();
    expect(observed).toEqual([firstKey, secondKey]);
  } finally {
    backend.dispose();
  }
});

test('selection transform exceptions retain opaque identity and restore the callback scope', () => {
  const hook = foreignHookIndex().indexOf('selectionTransform');
  const backend = new ConformanceBackend({
    namespace: 'foreign selection transform error',
    nodes: [
      {
        type: 'throw-selection',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const failure = { opaque: 'selection transform exception' };
  let calls = 0;
  try {
    backend.installForeign('throw-selection', (message) => {
      calls++;
      if (calls === 1) throw failure;
      expect(message.args[0]).toBe(null);
      expect(message.args[1]).toEqual(
        backend.call('lexical.$getSelection', [])
      );
      return { ignored: true };
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'throw-selection',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['text'], node);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [node], paragraph);
    backend.call(
      'LexicalNode.append',
      [paragraph],
      backend.call('lexical.$getRoot', [])
    );
    backend.call('LexicalNode.select', [1, 1], node);
    let thrown: unknown;
    try {
      backend.flush();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);
    backend.flush();
    expect(calls).toBe(2);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('text');
    backend.commit();
    expect(calls).toBe(2);
  } finally {
    backend.dispose();
  }
});

test('explicit selectionTransform preserves original arguments and native-super bypasses once', () => {
  const hook = foreignHookIndex().indexOf('selectionTransform');
  const backend = new ConformanceBackend({
    namespace: 'explicit selection transform',
    nodes: [
      {
        type: 'explicit-selection',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  let alternate: unknown;
  try {
    backend.installForeign('explicit-selection', (message) => {
      calls++;
      expect(message.args).toEqual([null, alternate]);
      backend.callNative(
        'LexicalNode.selectionTransform',
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'explicit-selection',
      {},
    ]);
    alternate = backend.call('lexical.$createRangeSelection', []);
    backend.call('LexicalNode.selectionTransform', [null, alternate], node);
    expect(calls).toBe(1);
    expect(backend.call('lexical.$getSelection', [])).toBe(null);
    backend.setForeignMask('explicit-selection', 0n);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('previous selection and point handles first captured in an aborted update remain usable', () => {
  const backend = new ConformanceBackend({
    namespace: 'previous rollback',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const node = backend.call('lexical.$createTextNode', ['text']);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [node], paragraph);
    backend.call(
      'LexicalNode.append',
      [paragraph],
      backend.call('lexical.$getRoot', [])
    );
    backend.call('LexicalNode.select', [1, 2], node);
    const replacement = backend.call('lexical.$createTextNode', [
      'replacement',
    ]);
    backend.call('LexicalNode.replace', [replacement, false], node);
    backend.commit();
    backend.beginUpdate([], false);
    const previous = backend.call('lexical.$getPreviousSelection', []);
    const point = backend.call('get:anchor', [], previous);
    const stablePrevious = backend.call('lexical.$getPreviousSelection', []);
    const current = backend.call('lexical.$getSelection', []);
    expect(previous).not.toEqual(current);
    backend.discard();
    backend.beginUpdate([], false);
    expect(backend.call('lexical.$getPreviousSelection', [])).toEqual(
      stablePrevious
    );
    expect(backend.call('get:offset', [], point)).toBe(1);
    expect(() => backend.call('get:anchor', [], current)).toThrow(
      'unknown handle'
    );
    backend.commit();
  } finally {
    backend.dispose();
  }
});
