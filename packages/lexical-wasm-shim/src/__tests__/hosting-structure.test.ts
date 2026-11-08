import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';

test('foreign append keeps native append-to-splice dispatch virtual with encoded node arguments', () => {
  const append = foreignHookIndex().indexOf('append');
  const splice = foreignHookIndex().indexOf('splice');
  const backend = new ConformanceBackend({
    namespace: 'foreign append',
    nodes: [
      {
        type: 'custom-block',
        kind: 'Element',
        extends: 'paragraph',
        overrides: ((1n << BigInt(append)) | (1n << BigInt(splice))).toString(),
      },
    ],
  });
  const calls: string[] = [];
  try {
    let child: unknown;
    backend.installForeign('custom-block', (message) => {
      if (message.hook === append) {
        calls.push('append');
        expect(message.args).toEqual([child]);
        backend.callNative('LexicalNode.append', message.args, message.node);
      } else {
        expect(message.hook).toBe(splice);
        calls.push('splice');
        expect(message.args).toEqual([0, 0, [{ $h: expect.any(Number) }]]);
        expect(Array.isArray(message.args[2])).toBe(true);
        const nodes = message.args[2];
        if (!Array.isArray(nodes))
          throw new Error('splice nodes are not an array');
        expect(nodes[0]).toEqual(
          backend.call('LexicalNode.getLatest', [], child)
        );
        expect(backend.call('LexicalNode.getTextContent', [], nodes[0])).toBe(
          'child'
        );
        backend.callNative('LexicalNode.splice', message.args, message.node);
      }
    });
    backend.beginUpdate([], false);
    const parent = backend.call('conformance.createForeignNode', [
      'custom-block',
      {},
    ]);
    child = backend.call('lexical.$createTextNode', ['child']);
    backend.call('LexicalNode.append', [child], parent);
    expect(calls).toEqual(['append', 'splice']);
    expect(backend.call('LexicalNode.getChildrenSize', [], parent)).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign splice may skip native writes and preserves original node array arguments', () => {
  const hook = foreignHookIndex().indexOf('splice');
  const backend = new ConformanceBackend({
    namespace: 'foreign splice children',
    nodes: [
      {
        type: 'custom-splice-block',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const observed: unknown[] = [];
  try {
    backend.installForeign('custom-splice-block', (message) => {
      expect(message.hook).toBe(hook);
      observed.push(message.args);
      return { ignored: true };
    });
    backend.beginUpdate([], false);
    const parent = backend.call('conformance.createForeignNode', [
      'custom-splice-block',
      {},
    ]);
    const child = backend.call('lexical.$createTextNode', ['child']);
    backend.call('LexicalNode.splice', [0, 0, [child]], parent);
    expect(observed).toEqual([[0, 0, [child]]]);
    expect(backend.call('LexicalNode.getChildrenSize', [], parent)).toBe(0);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign remove owns the operation and may retain an attached node', () => {
  const hook = foreignHookIndex().indexOf('remove');
  const backend = new ConformanceBackend({
    namespace: 'foreign remove',
    nodes: [
      {
        type: 'custom-remove',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-remove', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([true]);
      if (calls === 2)
        backend.callNative('LexicalNode.remove', message.args, message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-remove',
      {},
    ]);
    const parent = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [node], parent);
    backend.call(
      'LexicalNode.append',
      [parent],
      backend.call('lexical.$getRoot', [])
    );
    backend.call('LexicalNode.remove', [true], node);
    expect(backend.call('LexicalNode.isAttached', [], node)).toBe(true);
    backend.call('LexicalNode.remove', [true], node);
    expect(backend.call('LexicalNode.isAttached', [], node)).toBe(false);
    expect(calls).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign setIndent can change the requested value through native-super', () => {
  const hook = foreignHookIndex().indexOf('setIndent');
  const backend = new ConformanceBackend({
    namespace: 'foreign indent',
    nodes: [
      {
        type: 'custom-indent',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-indent', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([2]);
      backend.callNative('LexicalNode.setIndent', [3], message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-indent',
      {},
    ]);
    backend.call('LexicalNode.setIndent', [2], node);
    expect(backend.call('LexicalNode.getIndent', [], node)).toBe(3);
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign updateFromJSON retains unknown JSON fields and owns the complete update', () => {
  const hook = foreignHookIndex().indexOf('updateFromJSON');
  const backend = new ConformanceBackend({
    namespace: 'foreign JSON update',
    nodes: [
      {
        type: 'custom-json',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const serialized = {
    type: 'custom-json',
    version: 1,
    text: 'changed',
    format: 1,
    detail: 0,
    mode: 'normal',
    style: '',
    extra: { retained: true },
  };
  let calls = 0;
  try {
    backend.installForeign('custom-json', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([serialized]);
      backend.callNative(
        'LexicalNode.updateFromJSON',
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-json',
      {},
    ]);
    backend.call('LexicalNode.updateFromJSON', [serialized], node);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe(
      'changed'
    );
    expect(backend.call('LexicalNode.getFormat', [], node)).toBe(1);
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign resetOnCopyNodeFrom receives the original captured node', () => {
  const hook = foreignHookIndex().indexOf('resetOnCopyNodeFrom');
  const backend = new ConformanceBackend({
    namespace: 'foreign reset copy',
    nodes: [
      {
        type: 'custom-copy',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    let original: unknown;
    backend.installForeign('custom-copy', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([original]);
      expect(
        backend.call('LexicalNode.getTextContent', [], message.args[0])
      ).toBe('source');
      backend.call('LexicalNode.setTextContent', ['reset'], message.node);
    });
    backend.beginUpdate([], false);
    original = backend.call('conformance.createForeignNode', [
      'custom-copy',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['source'], original);
    const copy = backend.call('conformance.createForeignNode', [
      'custom-copy',
      {},
    ]);
    backend.call('LexicalNode.resetOnCopyNodeFrom', [original], copy);
    expect(backend.call('LexicalNode.getTextContent', [], copy)).toBe('reset');
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
