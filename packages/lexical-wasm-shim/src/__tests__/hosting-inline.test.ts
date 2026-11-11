import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('isInline uses an owned read peer, original arguments, truthiness and native super', () => {
  const hook = foreignHookIndex().indexOf('isInline');
  const backend = new ConformanceBackend({
    namespace: 'inline read',
    nodes: [
      {
        type: 'inline-element',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let node: unknown;
  let calls = 0;
  const truthy = Object.defineProperty({}, 'ignored', {
    get() {
      throw new Error('do not inspect predicates');
    },
  });
  try {
    backend.installForeign('inline-element', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual(['extra']);
      expect(handles.node(message.node)).toBe(handles.node(node));
      expect(backend.callNative('LexicalNode.isInline', [], message.node)).toBe(
        false
      );
      expect(backend.call('LexicalNode.getType', [], message.node)).toBe(
        'inline-element'
      );
      expect(() =>
        backend.call('LexicalNode.setIndent', [3], message.node)
      ).toThrow(/read-only/);
      return truthy;
    });
    backend.beginUpdate([], false);
    node = backend.call('conformance.createForeignNode', [
      'inline-element',
      {},
    ]);
    handles.node(node);
    expect(backend.call('LexicalNode.isInline', ['extra'], node)).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('a throwing inline predicate stops later callbacks and recovers with unchanged pending text', () => {
  const hook = foreignHookIndex().indexOf('isInline');
  const backend = new ConformanceBackend({
    namespace: 'inline failure',
    nodes: [
      {
        type: 'checked-inline',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let first: object;
  let fail = false;
  let firstCalls = 0;
  let laterCalls = 0;
  const opaque = {};
  try {
    backend.installForeign('checked-inline', (message) => {
      if (handles.node(message.node) === first) {
        firstCalls++;
        if (fail) throw opaque;
      } else {
        laterCalls++;
      }
      return false;
    });
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const one = backend.call('conformance.createForeignNode', [
      'checked-inline',
      {},
    ]);
    first = handles.node(one);
    const two = backend.call('conformance.createForeignNode', [
      'checked-inline',
      {},
    ]);
    handles.node(two);
    const firstText = backend.call('lexical.$createTextNode', ['first']);
    const secondText = backend.call('lexical.$createTextNode', ['second']);
    backend.call('LexicalNode.append', [firstText], one);
    backend.call('LexicalNode.append', [secondText], two);
    backend.call('LexicalNode.append', [one, two], root);
    firstCalls = 0;
    laterCalls = 0;
    fail = true;
    try {
      backend.call('LexicalNode.getTextContent', [], root);
      throw new Error('predicate must throw');
    } catch (error) {
      expect(error).toBe(opaque);
    }
    expect(firstCalls).toBe(1);
    expect(laterCalls).toBe(0);
    fail = false;
    expect(backend.call('LexicalNode.getTextContent', [], root)).toBe(
      'first\n\nsecond'
    );
    expect(laterCalls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('text and line-break inline flags stay fixed without calling their JS overrides', () => {
  const mask = (
    1n << BigInt(foreignHookIndex().indexOf('isInline'))
  ).toString();
  const backend = new ConformanceBackend({
    namespace: 'fixed inline flags',
    nodes: [
      { type: 'fixed-text', kind: 'Text', overrides: mask },
      { type: 'fixed-break', kind: 'LineBreak', overrides: mask },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('fixed-text', () => {
      calls++;
      return false;
    });
    backend.installForeign('fixed-break', () => {
      calls++;
      return false;
    });
    backend.beginUpdate([], false);
    const text = backend.call('conformance.createForeignNode', [
      'fixed-text',
      {},
    ]);
    const linebreak = backend.call('conformance.createForeignNode', [
      'fixed-break',
      {},
    ]);
    expect(backend.call('LexicalNode.isInline', [], text)).toBe(true);
    expect(backend.call('LexicalNode.isInline', [], linebreak)).toBe(true);
    expect(calls).toBe(0);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('a caught nested predicate throw stays isolated from its parent operation', () => {
  const hook = foreignHookIndex().indexOf('isInline');
  const backend = new ConformanceBackend({
    namespace: 'nested inline failure',
    nodes: [
      {
        type: 'nested-inline',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let outer: object;
  let inner: unknown;
  let fail = true;
  let calls = 0;
  try {
    backend.installForeign('nested-inline', (message) => {
      calls++;
      if (handles.node(message.node) === outer) {
        try {
          backend.call('LexicalNode.isInline', [], inner);
          throw new Error('inner must throw');
        } catch (error) {
          expect(error).toBeUndefined();
        }
        return true;
      }
      if (fail) throw undefined;
      return false;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'nested-inline',
      {},
    ]);
    outer = handles.node(node);
    inner = backend.call('conformance.createForeignNode', [
      'nested-inline',
      {},
    ]);
    handles.node(inner);
    expect(backend.call('LexicalNode.isInline', [], node)).toBe(true);
    expect(calls).toBe(2);
    fail = false;
    expect(backend.call('LexicalNode.isInline', [], inner)).toBe(false);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('insertNodes stops at a throwing inline predicate before later writes and then recovers', () => {
  const hook = foreignHookIndex().indexOf('isInline');
  const backend = new ConformanceBackend({
    namespace: 'inline insertion failure',
    nodes: [
      {
        type: 'inserted-block',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let fail = false;
  let root: unknown;
  let paragraph: unknown;
  let textAtThrow: unknown;
  let childrenAtThrow: unknown;
  let offsetAtThrow: unknown;
  const opaque = {};
  try {
    backend.installForeign('inserted-block', () => {
      if (fail) {
        textAtThrow = backend.call('LexicalNode.getTextContent', [], root);
        childrenAtThrow = backend.call(
          'LexicalNode.getChildrenKeys',
          [],
          paragraph
        );
        const selection = backend.call('lexical.$getSelection', []);
        const anchor = backend.call('get:anchor', [], selection);
        offsetAtThrow = backend.call('get:offset', [], anchor);
        throw opaque;
      }
      return false;
    });
    backend.beginUpdate([], false);
    root = backend.call('lexical.$getRoot', []);
    paragraph = backend.call('lexical.$createParagraphNode', []);
    const text = backend.call('lexical.$createTextNode', ['host']);
    backend.call('LexicalNode.append', [text], paragraph);
    backend.call('LexicalNode.append', [paragraph], root);
    backend.call('LexicalNode.select', [1, 1], text);
    const selection = backend.call('lexical.$getSelection', []);
    const inserted = backend.call('conformance.createForeignNode', [
      'inserted-block',
      {},
    ]);
    const insertedText = backend.call('lexical.$createTextNode', ['new']);
    backend.call('LexicalNode.append', [insertedText], inserted);
    fail = true;
    try {
      backend.call('Selection.insertNodes', [[inserted]], selection);
      throw new Error('insert must throw');
    } catch (error) {
      expect(error).toBe(opaque);
    }
    expect(textAtThrow).toBe('host');
    expect(backend.call('LexicalNode.getTextContent', [], root)).toBe(
      textAtThrow
    );
    expect(backend.call('LexicalNode.getChildrenKeys', [], paragraph)).toEqual(
      childrenAtThrow
    );
    const anchor = backend.call('get:anchor', [], selection);
    expect(backend.call('get:offset', [], anchor)).toBe(offsetAtThrow);
    expect(backend.call('LexicalNode.getParent', [], inserted)).toBeNull();
    fail = false;
    backend.call('Selection.insertNodes', [[inserted]], selection);
    expect(backend.call('LexicalNode.getTextContent', [], root)).toContain(
      'new'
    );
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('a mutable hook can catch a command listener predicate failure and continue writing', () => {
  const inline = foreignHookIndex().indexOf('isInline');
  const set = foreignHookIndex().indexOf('setTextContent');
  const backend = new ConformanceBackend({
    namespace: 'command predicate failure',
    nodes: [
      {
        type: 'command-inline',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(inline)).toString(),
      },
      {
        type: 'command-text',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(set)).toString(),
      },
    ],
  });
  const command = {};
  const opaque = {};
  let block: unknown;
  let caught = 0;
  try {
    backend.installForeign('command-inline', () => {
      throw opaque;
    });
    backend.installForeign('command-text', (message) => {
      try {
        backend.dispatchCommand(command, null);
        throw new Error('listener must throw');
      } catch (error) {
        expect(error).toBe(opaque);
        caught++;
      }
      return backend.callNative(
        'LexicalNode.setTextContent',
        message.args,
        message.node
      );
    });
    backend.registerListener(command, 0, () =>
      backend.call('LexicalNode.isInline', [], block)
    );
    backend.beginUpdate([], false);
    block = backend.call('conformance.createForeignNode', [
      'command-inline',
      {},
    ]);
    const text = backend.call('conformance.createForeignNode', [
      'command-text',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['changed'], text);
    expect(caught).toBe(1);
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe(
      'changed'
    );
    backend.discard();
  } finally {
    backend.dispose();
  }
});
