import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('static importJSON constructs and returns a captured node through indexed reentry', () => {
  const hook = foreignHookIndex().indexOf('importJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign import',
    nodes: [
      {
        type: 'import-text',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  const serialized = {
    type: 'import-text',
    version: 1,
    text: '😀é',
    format: 1,
    detail: 0,
    mode: 'normal',
    style: 'color: red;',
    extra: { nested: [1, true] },
  };
  let calls = 0;
  let constructed: unknown;
  try {
    backend.installForeign('import-text', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.node).toBe(null);
      expect(message.args).toEqual([serialized]);
      constructed = backend.call('conformance.createForeignNode', [
        'import-text',
        {},
      ]);
      handles.node(constructed);
      return backend.callNative(
        'LexicalNode.updateFromJSON',
        message.args,
        constructed
      );
    });
    backend.beginUpdate([], false);
    const parsed = backend.call('lexical.$parseSerializedNode', [serialized]);
    expect(handles.node(parsed)).toBe(handles.node(constructed));
    expect(backend.call('LexicalNode.getTextContent', [], parsed)).toBe('😀é');
    expect(backend.call('LexicalNode.getTextContentSize', [], parsed)).toBe(4);
    expect(backend.call('LexicalNode.getFormat', [], parsed)).toBe(1);
    expect(backend.call('LexicalNode.getStyle', [], parsed)).toBe(
      'color: red;'
    );
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('serialized element recursion imports children before virtual append', () => {
  const hook = foreignHookIndex().indexOf('importJSON');
  const append = foreignHookIndex().indexOf('append');
  const backend = new ConformanceBackend({
    namespace: 'foreign recursive import',
    nodes: [
      {
        type: 'import-element',
        kind: 'Element',
        extends: 'paragraph',
        overrides: ((1n << BigInt(hook)) | (1n << BigInt(append))).toString(),
      },
      {
        type: 'import-child',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const events: string[] = [];
  try {
    backend.installForeign('import-element', (message) => {
      if (message.hook === append) {
        events.push('append');
        return backend.callNative(
          'LexicalNode.append',
          message.args,
          message.node
        );
      }
      expect(message.hook).toBe(hook);
      expect(message.node).toBe(null);
      events.push('element');
      return backend.call('conformance.createForeignNode', [
        'import-element',
        {},
      ]);
    });
    backend.installForeign('import-child', (message) => {
      expect(message.hook).toBe(hook);
      expect(message.node).toBe(null);
      events.push('child');
      const node = backend.call('conformance.createForeignNode', [
        'import-child',
        {},
      ]);
      return backend.callNative(
        'LexicalNode.updateFromJSON',
        message.args,
        node
      );
    });
    backend.beginUpdate([], false);
    const parsed = backend.call('lexical.$parseSerializedNode', [
      {
        type: 'import-element',
        version: 1,
        children: [
          {
            type: 'import-child',
            version: 1,
            text: 'child',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
    ]);
    expect(events).toEqual(['element', 'child', 'append']);
    expect(backend.call('LexicalNode.getTextContent', [], parsed)).toBe(
      'child'
    );
    expect(backend.call('LexicalNode.getChildrenSize', [], parsed)).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('import factories preserve opaque exceptions and reject invalid returns without losing scope', () => {
  const hook = foreignHookIndex().indexOf('importJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign import errors',
    nodes: [
      {
        type: 'import-errors',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const failure = { opaque: 'import exception' };
  let calls = 0;
  try {
    backend.installForeign('import-errors', () => {
      calls++;
      if (calls === 1) throw failure;
      if (calls === 2) return null;
      if (calls === 3) return undefined;
      if (calls === 4) return { $h: 999999 };
      return backend.call('lexical.$createTextNode', ['recovered']);
    });
    backend.beginUpdate([], false);
    let thrown: unknown;
    try {
      backend.call('lexical.$parseSerializedNode', [
        { type: 'import-errors', version: 1 },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);
    expect(() =>
      backend.call('lexical.$parseSerializedNode', [
        { type: 'import-errors', version: 1 },
      ])
    ).toThrow('foreign hook must return a node handle');
    expect(() =>
      backend.call('lexical.$parseSerializedNode', [
        { type: 'import-errors', version: 1 },
      ])
    ).toThrow('foreign hook must return a node handle');
    expect(() =>
      backend.call('lexical.$parseSerializedNode', [
        { type: 'import-errors', version: 1 },
      ])
    ).toThrow('unknown handle');
    const parsed = backend.call('lexical.$parseSerializedNode', [
      { type: 'import-errors', version: 1 },
    ]);
    expect(backend.call('LexicalNode.getTextContent', [], parsed)).toBe(
      'recovered'
    );
    expect(calls).toBe(5);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('an inherited import factory creates the foreign type and invokes its virtual JSON updater', () => {
  const update = foreignHookIndex().indexOf('updateFromJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign inherited import',
    nodes: [
      {
        type: 'inherited-import',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(update)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('inherited-import', (message) => {
      calls++;
      expect(message.hook).toBe(update);
      return backend.callNative(
        'LexicalNode.updateFromJSON',
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const parsed = backend.call('lexical.$parseSerializedNode', [
      {
        type: 'inherited-import',
        version: 1,
        text: 'native path',
        format: 0,
        detail: 0,
        mode: 'normal',
        style: '',
      },
    ]);
    expect(backend.call('LexicalNode.getType', [], parsed)).toBe(
      'inherited-import'
    );
    expect(backend.call('LexicalNode.getTextContent', [], parsed)).toBe(
      'native path'
    );
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
