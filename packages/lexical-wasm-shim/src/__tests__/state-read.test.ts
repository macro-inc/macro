import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';

test('associated state reads preserve opaque returns and errors and reject writes', () => {
  const backend = new ConformanceBackend({ namespace: 'state reads' });
  try {
    const value = Object.defineProperty({}, 'untouched', {
      get() {
        throw new Error('read result must stay opaque');
      },
    });
    expect(
      backend.readState('0', () => {
        const root = backend.call('lexical.$getRoot', []);
        expect(backend.call('LexicalNode.getTextContent', [], root)).toBe('');
        expect(() => backend.call('lexical.$createTextNode', ['no'])).toThrow();
        expect(() => backend.call('lexical.$addUpdateTag', ['no'])).toThrow();
        expect(() => backend.registerTransform('text', () => {})).toThrow();
        expect(backend.callNative('LexicalNode.isInline', [], root)).toBe(
          false
        );
        return value;
      })
    ).toBe(value);
    try {
      backend.readState('0', () => {
        throw undefined;
      });
      throw new Error('read must throw');
    } catch (error) {
      expect(error).toBeUndefined();
    }
    expect(() => backend.readState('999', () => {})).toThrow(
      /released|published/
    );
    expect(backend.readState('0', () => 42)).toBe(42);
  } finally {
    backend.dispose();
  }
});

test('historical read nesting restores the outer graph and retains latest selection owners', () => {
  const backend = new ConformanceBackend({ namespace: 'old state reads' });
  try {
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    let text = backend.call('lexical.$createTextNode', ['first']);
    backend.call('LexicalNode.append', [text], paragraph);
    backend.call('LexicalNode.append', [paragraph], root);
    backend.call('LexicalNode.select', [1, 1], text);
    backend.commit();
    backend.beginUpdate([], false);
    backend.call('LexicalNode.setTextContent', ['second'], text);
    backend.call('LexicalNode.select', [2, 2], text);
    backend.commit();
    text = backend.readState('2', () =>
      backend.call('LexicalNode.getLatest', [], text)
    );
    let previousPoint: unknown;
    let oldSelection: unknown;
    const opaque = {};
    backend.readState('1', () => {
      const root = backend.call('lexical.$getRoot', []);
      expect(backend.call('LexicalNode.getTextContent', [], root)).toBe(
        'first'
      );
      oldSelection = backend.call('lexical.$getSelection', []);
      const point = backend.call('get:anchor', [], oldSelection);
      expect(backend.call('get:offset', [], point)).toBe(1);
      const previous = backend.call('lexical.$getPreviousSelection', []);
      previousPoint = backend.call('get:anchor', [], previous);
      expect(backend.call('get:offset', [], previousPoint)).toBe(2);
      try {
        backend.readState('2', () => {
          const latest = backend.call('lexical.$getRoot', []);
          expect(backend.call('LexicalNode.getTextContent', [], latest)).toBe(
            'second'
          );
          throw opaque;
        });
        throw new Error('nested read must throw');
      } catch (error) {
        expect(error).toBe(opaque);
      }
      expect(backend.call('LexicalNode.getTextContent', [], root)).toBe(
        'first'
      );
    });
    backend.releaseVersion('1');
    backend.readState('2', () => {
      expect(backend.call('get:offset', [], previousPoint)).toBe(2);
      expect(() => backend.call('get:anchor', [], oldSelection)).toThrow();
    });
    expect(() => backend.readState('1', () => {})).toThrow(/released/);
    backend.beginUpdate([], false);
    backend.call('LexicalNode.setTextContent', ['pending'], text);
    backend.readState('2', () => {
      const root = backend.call('lexical.$getRoot', []);
      expect(backend.call('LexicalNode.getTextContent', [], root)).toBe(
        'second'
      );
    });
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe(
      'pending'
    );
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('state reads nest in mutable foreign hooks and publication export callbacks', () => {
  const set = foreignHookIndex().indexOf('setTextContent');
  const exportJSON = foreignHookIndex().indexOf('exportJSON');
  const backend = new ConformanceBackend({
    namespace: 'callback state reads',
    nodes: [
      {
        type: 'state-text',
        kind: 'Text',
        extends: 'text',
        overrides: (
          (1n << BigInt(set)) |
          (1n << BigInt(exportJSON))
        ).toString(),
      },
    ],
  });
  let reads = 0;
  try {
    backend.installForeign('state-text', (message) => {
      backend.readState('0', () => {
        const root = backend.call('lexical.$getRoot', []);
        expect(backend.call('LexicalNode.getTextContent', [], root)).toBe('');
        reads++;
      });
      if (message.hook === set)
        return backend.callNative(
          'LexicalNode.setTextContent',
          message.args,
          message.node
        );
      return backend.callNative('LexicalNode.exportJSON', [], message.node);
    });
    backend.beginUpdate([], false);
    const root = backend.call('lexical.$getRoot', []);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    const node = backend.call('conformance.createForeignNode', [
      'state-text',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['text'], node);
    backend.call('LexicalNode.append', [node], paragraph);
    backend.call('LexicalNode.append', [paragraph], root);
    backend.commit();
    expect(reads).toBeGreaterThan(1);
    backend.readState('1', () => {
      const root = backend.call('lexical.$getRoot', []);
      expect(backend.call('LexicalNode.getTextContent', [], root)).toBe('text');
      expect(backend.call('LexicalNode.exportJSON', [], node)).toMatchObject({
        type: 'state-text',
        text: 'text',
      });
    });
  } finally {
    backend.dispose();
  }
});

test('read-created selection objects survive a surrounding pending rollback without ID reuse', () => {
  const backend = new ConformanceBackend({ namespace: 'read value rollback' });
  try {
    backend.beginUpdate([], false);
    const abandoned = backend.call('lexical.$createRangeSelection', []);
    let selection: unknown;
    let point: unknown;
    backend.readState('0', () => {
      selection = backend.call('lexical.$createRangeSelection', []);
      point = backend.call('get:anchor', [], selection);
      backend.call('Selection.set', ['root', 4, 'element'], point);
    });
    backend.discard();
    backend.beginUpdate([], false);
    const fresh = backend.call('lexical.$createRangeSelection', []);
    expect(fresh).not.toEqual(selection);
    expect(() => backend.call('get:anchor', [], abandoned)).toThrow();
    expect(backend.call('get:offset', [], point)).toBe(4);
    expect(backend.call('get:anchor', [], selection)).toEqual(point);
    backend.discard();
  } finally {
    backend.dispose();
  }
});
