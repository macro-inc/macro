import { expect, test } from 'vitest';
import {
  ConformanceBackend,
  diagnostics,
  foreignHookIndex,
} from '../backend/conformance';

test('getIndent returns a typed scalar through native export and native super', () => {
  const hook = foreignHookIndex().indexOf('getIndent');
  const backend = new ConformanceBackend({
    namespace: 'indent read',
    nodes: [
      {
        type: 'indented',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  let result: unknown = 3;
  try {
    backend.installForeign('indented', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(
        backend.callNative('LexicalNode.getIndent', [], message.node)
      ).toBe(1);
      expect(() =>
        backend.call('LexicalNode.setIndent', [2], message.node)
      ).toThrow(/read-only/);
      return result;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'indented',
      {},
    ]);
    backend.call('LexicalNode.setIndent', [1], node);
    expect(backend.call('LexicalNode.getIndent', [], node)).toBe(3);
    expect(backend.call('LexicalNode.exportJSON', [], node)).toMatchObject({
      indent: 3,
    });
    expect(calls).toBe(2);
    result = -1;
    expect(() => backend.call('LexicalNode.getIndent', [], node)).toThrow(
      /u32/
    );
    result = 1.5;
    expect(() => backend.call('LexicalNode.getIndent', [], node)).toThrow(
      /u32/
    );
    result = 4294967296;
    expect(() => backend.call('LexicalNode.getIndent', [], node)).toThrow(
      /u32/
    );
    result = 4;
    expect(backend.call('LexicalNode.getIndent', [], node)).toBe(4);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('decorator getTextContent contributes Unicode text and opaque failures recover', () => {
  const hook = foreignHookIndex().indexOf('getTextContent');
  const backend = new ConformanceBackend({
    namespace: 'decorator text read',
    nodes: [
      {
        type: 'caption',
        kind: 'Decorator',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const opaque = {};
  let fail = false;
  let calls = 0;
  try {
    backend.installForeign('caption', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.getTextContent', [], message.node)
      ).toBe('');
      if (fail) throw opaque;
      return '😀é';
    });
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    const node = backend.call('conformance.createForeignNode', ['caption', {}]);
    backend.call('LexicalNode.append', [node], paragraph);
    backend.call('LexicalNode.append', [paragraph], root);
    expect(backend.call('LexicalNode.getTextContent', [], root)).toBe('😀é');
    expect(backend.call('LexicalNode.getTextContentSize', [], node)).toBe(4);
    fail = true;
    try {
      backend.call('LexicalNode.getTextContent', [], root);
      throw new Error('read must throw');
    } catch (error) {
      expect(error).toBe(opaque);
    }
    expect(calls).toBe(3);
    fail = false;
    expect(backend.call('LexicalNode.getTextContent', [], root)).toBe('😀é');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('scalar hooks reject objects without reading getters or coercing them', () => {
  const hook = foreignHookIndex().indexOf('getTextContent');
  const backend = new ConformanceBackend({
    namespace: 'scalar object rejection',
    nodes: [
      {
        type: 'invalid-caption',
        kind: 'Decorator',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let reads = 0;
  const value = new Proxy(
    {},
    {
      get() {
        reads++;
        throw new Error('no result coercion');
      },
    }
  );
  let invalid = true;
  try {
    backend.installForeign('invalid-caption', () =>
      invalid ? value : 'valid'
    );
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'invalid-caption',
      {},
    ]);
    expect(() => backend.call('LexicalNode.getTextContent', [], node)).toThrow(
      /primitive scalar/
    );
    expect(reads).toBe(0);
    invalid = false;
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('valid');
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('excludeFromCopy preserves optional destinations, native super and truthiness', () => {
  const hook = foreignHookIndex().indexOf('excludeFromCopy');
  const backend = new ConformanceBackend({
    namespace: 'copy destination read',
    nodes: [
      {
        type: 'copy-filter',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const argumentsSeen: unknown[][] = [];
  try {
    backend.installForeign('copy-filter', (message) => {
      argumentsSeen.push(message.args);
      expect(
        backend.callNative(
          'LexicalNode.excludeFromCopy',
          message.args,
          message.node
        )
      ).toBe(false);
      return message.args[0] === 'html' ? {} : 0;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'copy-filter',
      {},
    ]);
    expect(backend.call('LexicalNode.excludeFromCopy', [], node)).toBe(false);
    expect(
      backend.call('LexicalNode.excludeFromCopy', [{ $undef: true }], node)
    ).toBe(false);
    expect(backend.call('LexicalNode.excludeFromCopy', ['clone'], node)).toBe(
      false
    );
    expect(backend.call('LexicalNode.excludeFromCopy', ['html'], node)).toBe(
      true
    );
    expect(argumentsSeen).toEqual([
      [],
      [{ $undef: true }],
      ['clone'],
      ['html'],
    ]);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('text getTextContent stays native despite a foreign mask bit', () => {
  const hook = foreignHookIndex().indexOf('getTextContent');
  const backend = new ConformanceBackend({
    namespace: 'text read nonhook',
    nodes: [
      {
        type: 'native-text-read',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('native-text-read', () => {
      calls++;
      return 'wrong';
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'native-text-read',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['native'], node);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('native');
    expect(calls).toBe(0);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('element getTextContent stays native despite a foreign mask bit', () => {
  const hook = foreignHookIndex().indexOf('getTextContent');
  const backend = new ConformanceBackend({
    namespace: 'element read nonhook',
    nodes: [
      {
        type: 'native-element-read',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('native-element-read', () => {
      calls++;
      return 'wrong';
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'native-element-read',
      {},
    ]);
    const text = backend.call('lexical.$createTextNode', ['native']);
    backend.call('LexicalNode.append', [text], node);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('native');
    expect(calls).toBe(0);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('nonfinite scalar returns count their consumed numeric bytes before rejection', () => {
  const hook = foreignHookIndex().indexOf('getIndent');
  const backend = new ConformanceBackend({
    namespace: 'nonfinite scalar bytes',
    nodes: [
      {
        type: 'invalid-indent',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let result = Number.NaN;
  let during = 0;
  try {
    backend.installForeign('invalid-indent', () => {
      during = diagnostics.bytes();
      return result;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'invalid-indent',
      {},
    ]);
    diagnostics.resetCounters();
    let nanError: unknown;
    try {
      backend.call('LexicalNode.getIndent', [], node);
    } catch (error) {
      nanError = error;
    }
    expect(nanError).toBeInstanceOf(Error);
    if (!(nanError instanceof Error)) throw new Error('expected scalar error');
    expect(nanError.message).toContain('finite scalar');
    expect(diagnostics.bytes() - during).toBe(16 + nanError.message.length * 2);
    result = Number.POSITIVE_INFINITY;
    diagnostics.resetCounters();
    let infinityError: unknown;
    try {
      backend.call('LexicalNode.getIndent', [], node);
    } catch (error) {
      infinityError = error;
    }
    expect(infinityError).toBeInstanceOf(Error);
    if (!(infinityError instanceof Error))
      throw new Error('expected scalar error');
    expect(infinityError.message).toContain('finite scalar');
    expect(diagnostics.bytes() - during).toBe(
      16 + infinityError.message.length * 2
    );
    result = 2;
    expect(backend.call('LexicalNode.getIndent', [], node)).toBe(2);
    backend.discard();
  } finally {
    backend.dispose();
  }
});
