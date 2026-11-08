import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('exportJSON reads pending fields and uses native super through an owned read peer', () => {
  const hook = foreignHookIndex().indexOf('exportJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign export',
    nodes: [
      {
        type: 'export-text',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let node: unknown;
  let calls = 0;
  try {
    backend.installForeign('export-text', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual(['original extra argument']);
      expect(handles.node(message.node)).toBe(handles.node(node));
      expect(backend.call('LexicalNode.getTextContent', [], message.node)).toBe(
        '😀pending'
      );
      const result = backend.callNative(
        'LexicalNode.exportJSON',
        [],
        message.node
      );
      expect(result).toMatchObject({
        type: 'export-text',
        version: 1,
        text: '😀pending',
      });
      return { ...Object(result), marker: ['custom', true] };
    });
    backend.beginUpdate([], false);
    node = backend.call('conformance.createForeignNode', ['export-text', {}]);
    handles.node(node);
    backend.call('LexicalNode.setTextContent', ['😀pending'], node);
    expect(
      backend.call('LexicalNode.exportJSON', ['original extra argument'], node)
    ).toMatchObject({
      type: 'export-text',
      text: '😀pending',
      marker: ['custom', true],
    });
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('exportJSON guards writes, preserves local values and rejects unsupported publication captures', () => {
  const hook = foreignHookIndex().indexOf('exportJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign export guards',
    nodes: [
      {
        type: 'guard-export',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let detached: unknown;
  try {
    backend.installForeign('guard-export', (message) => {
      expect(() =>
        backend.call('LexicalNode.setTextContent', ['wrong'], message.node)
      ).toThrow();
      expect(() =>
        backend.call('lexical.$createTextNode', ['wrong'])
      ).toThrow();
      expect(() => backend.call('lexical.$addUpdateTag', ['wrong'])).toThrow(
        'editor effects are forbidden'
      );
      expect(() => backend.dispatchCommand({}, null)).toThrow(
        'editor effects are forbidden'
      );
      expect(() => backend.registerTransform('guard-export', () => {})).toThrow(
        'editor effects are forbidden'
      );
      const selection = backend.call('lexical.$getSelection', []);
      const inherited = backend.call('get:anchor', [], selection);
      const key = backend.call('LexicalNode.getKey', [], message.node);
      expect(() =>
        backend.call('Selection.set', [key, 0, 'text'], inherited)
      ).toThrow('inherited selection value writes');
      detached = backend.call('Selection.clone', [], selection);
      const point = backend.call('get:anchor', [], detached);
      backend.call('Selection.set', [key, 3, 'text'], point);
      expect(backend.call('get:offset', [], point)).toBe(3);
      expect(backend.call('get:offset', [], inherited)).toBe(1);
      return backend.callNative('LexicalNode.exportJSON', [], message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'guard-export',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['safe'], node);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [node], paragraph);
    backend.call(
      'LexicalNode.append',
      [paragraph],
      backend.call('lexical.$getRoot', [])
    );
    backend.call('LexicalNode.select', [1, 1], node);
    expect(backend.call('LexicalNode.exportJSON', [], node)).toMatchObject({
      text: 'safe',
    });
    const point = backend.call('get:anchor', [], detached);
    expect(backend.call('get:offset', [], point)).toBe(3);
    const active = backend.call('lexical.$getSelection', []);
    expect(
      backend.call('get:offset', [], backend.call('get:anchor', [], active))
    ).toBe(1);
    backend.call(
      'LexicalNode.setTextContent',
      ['mutable scope restored'],
      node
    );
    // Diff serialization currently supplies an originless committed capture.
    // Reject it until an exact publication capability is available.
    expect(() => backend.commit()).toThrow(
      'callback capture belongs to another editor or update'
    );
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    expect(backend.call('LexicalNode.getChildrenSize', [], root)).toBe(0);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('exportJSON propagates opaque exceptions and invalid returns without leaking its read scope', () => {
  const hook = foreignHookIndex().indexOf('exportJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign export errors',
    nodes: [
      {
        type: 'error-export',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const failure = { opaque: 'export error' };
  let calls = 0;
  try {
    backend.installForeign('error-export', (message) => {
      calls++;
      if (calls === 1) throw failure;
      if (calls === 2) throw undefined;
      if (calls === 3) return null;
      if (calls === 4) return [];
      if (calls === 5) return undefined;
      return backend.callNative('LexicalNode.exportJSON', [], message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'error-export',
      {},
    ]);
    let caught: unknown = 'not thrown';
    try {
      backend.call('LexicalNode.exportJSON', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    caught = 'not thrown';
    try {
      backend.call('LexicalNode.exportJSON', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(undefined);
    expect(() => backend.call('LexicalNode.exportJSON', [], node)).toThrow(
      'exportJSON must return an object'
    );
    expect(() => backend.call('LexicalNode.exportJSON', [], node)).toThrow(
      'exportJSON must return an object'
    );
    expect(() => backend.call('LexicalNode.exportJSON', [], node)).toThrow(
      'exportJSON must return an object'
    );
    backend.call('LexicalNode.setTextContent', ['recovered'], node);
    expect(backend.call('LexicalNode.exportJSON', [], node)).toMatchObject({
      text: 'recovered',
    });
    expect(calls).toBe(6);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('nested exports restore the outer pure frame and the invoking mutable callback', () => {
  const hook = foreignHookIndex().indexOf('exportJSON');
  const setter = foreignHookIndex().indexOf('setTextContent');
  const backend = new ConformanceBackend({
    namespace: 'nested foreign export',
    nodes: [
      {
        type: 'nested-export',
        kind: 'Text',
        extends: 'text',
        overrides: ((1n << BigInt(hook)) | (1n << BigInt(setter))).toString(),
      },
    ],
  });
  let second: unknown;
  const events: string[] = [];
  try {
    backend.installForeign('nested-export', (message) => {
      if (message.hook === setter) {
        events.push('mutable');
        if (second !== undefined)
          backend.call('LexicalNode.exportJSON', [], second);
        backend.callNative(
          'LexicalNode.setTextContent',
          message.args,
          message.node
        );
        events.push('mutable restored');
        return;
      }
      expect(message.hook).toBe(hook);
      const text = backend.call('LexicalNode.getTextContent', [], message.node);
      events.push(String(text));
      if (text === 'outer') backend.call('LexicalNode.exportJSON', [], second);
      expect(backend.call('LexicalNode.getTextContent', [], message.node)).toBe(
        text
      );
      expect(() =>
        backend.call('LexicalNode.setTextContent', ['forbidden'], message.node)
      ).toThrow();
      events.push(`${String(text)} restored`);
      return backend.callNative('LexicalNode.exportJSON', [], message.node);
    });
    backend.beginUpdate([], false);
    const first = backend.call('conformance.createForeignNode', [
      'nested-export',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['outer'], first);
    const inner = backend.call('conformance.createForeignNode', [
      'nested-export',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['inner'], inner);
    second = inner;
    events.length = 0;
    backend.call('LexicalNode.exportJSON', [], first);
    expect(events).toEqual([
      'outer',
      'inner',
      'inner restored',
      'outer restored',
    ]);
    events.length = 0;
    backend.call('LexicalNode.setTextContent', ['after'], first);
    expect(events).toEqual([
      'mutable',
      'inner',
      'inner restored',
      'mutable restored',
    ]);
    expect(backend.call('LexicalNode.getTextContent', [], first)).toBe('after');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('an export result getter throws opaquely and leaves Rust callback and session scopes usable', () => {
  const hook = foreignHookIndex().indexOf('exportJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign export getter',
    nodes: [
      {
        type: 'getter-export',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const failure = { opaque: 'getter error' };
  let calls = 0;
  try {
    backend.installForeign('getter-export', (message) => {
      calls++;
      if (calls < 3)
        return {
          get text() {
            if (calls === 1) throw failure;
            throw undefined;
          },
        };
      return backend.callNative('LexicalNode.exportJSON', [], message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'getter-export',
      {},
    ]);
    let caught: unknown = 'not thrown';
    try {
      backend.call('LexicalNode.exportJSON', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    backend.call('LexicalNode.setTextContent', ['after first getter'], node);
    caught = 'not thrown';
    try {
      backend.call('LexicalNode.exportJSON', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(undefined);
    backend.call('LexicalNode.setTextContent', ['recovered'], node);
    expect(backend.call('LexicalNode.exportJSON', [], node)).toMatchObject({
      text: 'recovered',
    });
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('nested getters, proxies and array iterators stay inside the caught export conversion', () => {
  const hook = foreignHookIndex().indexOf('exportJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign export nested conversion',
    nodes: [
      {
        type: 'nested-conversion',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const failure = { opaque: 'nested conversion error' };
  let calls = 0;
  try {
    backend.installForeign('nested-conversion', (message) => {
      calls++;
      if (calls === 1)
        return {
          nested: {
            get value() {
              throw failure;
            },
          },
        };
      if (calls === 2)
        return {
          nested: new Proxy(
            {},
            {
              ownKeys() {
                throw undefined;
              },
            }
          ),
        };
      if (calls === 3) {
        const values: unknown[] = [];
        values[Symbol.iterator] = () => {
          throw failure;
        };
        return { nested: values };
      }
      return {
        get text() {
          expect(() =>
            backend.call(
              'LexicalNode.setTextContent',
              ['forbidden getter write'],
              message.node
            )
          ).toThrow();
          return backend.call('LexicalNode.getTextContent', [], message.node);
        },
      };
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'nested-conversion',
      {},
    ]);
    let caught: unknown = 'not thrown';
    try {
      backend.call('LexicalNode.exportJSON', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    backend.call('LexicalNode.setTextContent', ['after nested getter'], node);
    caught = 'not thrown';
    try {
      backend.call('LexicalNode.exportJSON', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(undefined);
    backend.call('LexicalNode.setTextContent', ['after proxy'], node);
    caught = 'not thrown';
    try {
      backend.call('LexicalNode.exportJSON', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    backend.call('LexicalNode.setTextContent', ['after iterator'], node);
    expect(backend.call('LexicalNode.exportJSON', [], node)).toEqual({
      text: 'after iterator',
    });
    backend.commit();
  } finally {
    backend.dispose();
  }
});
