import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('native range formatting honors a foreign canHaveFormat denial', () => {
  const hook = foreignHookIndex().indexOf('canHaveFormat');
  const backend = new ConformanceBackend({
    namespace: 'format predicate denial',
    nodes: [
      {
        type: 'unformatted-text',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('unformatted-text', (message) => {
      calls++;
      expect(
        backend.callNative('LexicalNode.canHaveFormat', [], message.node)
      ).toBe(true);
      return false;
    });
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    const text = backend.call('conformance.createForeignNode', [
      'unformatted-text',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['word'], text);
    backend.call('LexicalNode.append', [text], paragraph);
    backend.call('LexicalNode.append', [paragraph], root);
    const selection = backend.call('LexicalNode.select', [0, 4], text);
    backend.call('Selection.formatText', ['bold'], selection);
    expect(calls).toBeGreaterThan(0);
    expect(backend.call('LexicalNode.getFormat', [], text)).toBe(0);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('a throwing formatting predicate stops later predicates and format setters', () => {
  const canFormat = foreignHookIndex().indexOf('canHaveFormat');
  const setFormat = foreignHookIndex().indexOf('setFormat');
  const backend = new ConformanceBackend({
    namespace: 'format predicate failure',
    nodes: [
      {
        type: 'checked-format-text',
        kind: 'Text',
        extends: 'text',
        overrides: (
          (1n << BigInt(canFormat)) |
          (1n << BigInt(setFormat))
        ).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  const opaque = {};
  let first: object;
  let fail = false;
  let threw = false;
  let laterPredicates = 0;
  let laterWrites = 0;
  try {
    backend.installForeign('checked-format-text', (message) => {
      if (message.hook === canFormat) {
        if (handles.node(message.node) === first && fail) {
          threw = true;
          throw opaque;
        }
        if (threw) laterPredicates++;
        return true;
      }
      if (threw) laterWrites++;
      return backend.callNative(
        'LexicalNode.setFormat',
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    const one = backend.call('conformance.createForeignNode', [
      'checked-format-text',
      {},
    ]);
    const two = backend.call('conformance.createForeignNode', [
      'checked-format-text',
      {},
    ]);
    first = handles.node(one);
    handles.node(two);
    backend.call('LexicalNode.setTextContent', ['left'], one);
    backend.call('LexicalNode.setTextContent', ['right'], two);
    backend.call('LexicalNode.append', [one, two], paragraph);
    backend.call('LexicalNode.append', [paragraph], root);
    const selection = backend.call('LexicalNode.select', [0, 0], one);
    backend.call('Selection.setTextNodeRange', [one, 0, two, 5], selection);
    fail = true;
    try {
      backend.call('Selection.formatText', ['bold'], selection);
      throw new Error('formatting must throw');
    } catch (error) {
      expect(error).toBe(opaque);
    }
    expect(threw).toBe(true);
    expect(laterPredicates).toBe(0);
    expect(laterWrites).toBe(0);
    expect(backend.call('LexicalNode.getFormat', [], one)).toBe(0);
    expect(backend.call('LexicalNode.getFormat', [], two)).toBe(0);
    fail = false;
    threw = false;
    backend.call('Selection.formatText', ['bold'], selection);
    expect(backend.call('LexicalNode.getFormat', [], one)).toBe(1);
    expect(backend.call('LexicalNode.getFormat', [], two)).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
