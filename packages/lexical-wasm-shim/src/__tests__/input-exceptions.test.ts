import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';

test('input array getters and nested proxies throw opaquely and leave the editor usable', () => {
  const backend = new ConformanceBackend({ namespace: 'input exceptions' });
  const failure = { opaque: 'input getter' };
  try {
    backend.beginUpdate([], false);
    const args: unknown[] = [];
    Object.defineProperty(args, 0, {
      get() {
        throw failure;
      },
    });
    let caught: unknown = 'not thrown';
    try {
      backend.call('lexical.$createTextNode', args);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    const recovered = backend.call('lexical.$createTextNode', ['recovered']);
    expect(backend.call('LexicalNode.getTextContent', [], recovered)).toBe(
      'recovered'
    );
    const invalid = new Proxy(
      {},
      {
        ownKeys() {
          throw undefined;
        },
      }
    );
    caught = 'not thrown';
    try {
      backend.call('lexical.$createTextNode', [invalid]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(undefined);
    expect(backend.call('LexicalNode.getTextContent', [], recovered)).toBe(
      'recovered'
    );
    const reentrant: unknown[] = [];
    Object.defineProperty(reentrant, 0, {
      get() {
        const inner = backend.call('lexical.$createTextNode', ['inner']);
        return backend.call('LexicalNode.getTextContent', [], inner);
      },
    });
    const outer = backend.call('lexical.$createTextNode', reentrant);
    expect(backend.call('LexicalNode.getTextContent', [], outer)).toBe('inner');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('configuration and update-tag accessors preserve opaque exceptions before construction and update', () => {
  const failure = { opaque: 'configuration getter' };
  let caught: unknown = 'not thrown';
  try {
    new ConformanceBackend({
      get namespace() {
        throw failure;
      },
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
  const backend = new ConformanceBackend({ namespace: 'input tag exception' });
  try {
    const tags: string[] = [];
    Object.defineProperty(tags, 0, {
      get() {
        throw undefined;
      },
    });
    caught = 'not thrown';
    try {
      backend.beginUpdate(tags, false);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(undefined);
    backend.beginUpdate([], false);
    backend.call('lexical.$createTextNode', ['usable']);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('native-super input failure leaves the bypass and exact mutable callback usable', () => {
  const hook = foreignHookIndex().indexOf('setTextContent');
  const backend = new ConformanceBackend({
    namespace: 'native input exception',
    nodes: [
      {
        type: 'input-text',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const failure = { opaque: 'native-super input getter' };
  let calls = 0;
  try {
    backend.installForeign('input-text', (message) => {
      calls++;
      const args: unknown[] = [];
      Object.defineProperty(args, 0, {
        get() {
          throw failure;
        },
      });
      let caught: unknown = 'not thrown';
      try {
        backend.callNative('LexicalNode.setTextContent', args, message.node);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      return backend.callNative(
        'LexicalNode.setTextContent',
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'input-text',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['first'], node);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('first');
    backend.call('LexicalNode.setTextContent', ['second'], node);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('second');
    expect(calls).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('Map inputs retain their values and catch iterator-result accessors before mutation', () => {
  const backend = new ConformanceBackend({ namespace: 'input map exceptions' });
  const failure = { opaque: 'input iterator result' };
  try {
    backend.beginUpdate([], false);
    const node = backend.call('lexical.$createTextNode', ['before']);
    backend.call(
      'LexicalNode.updateFromJSON',
      [
        new Map<string, unknown>([
          ['text', 'map'],
          ['format', 0],
          ['detail', 0],
          ['mode', 'normal'],
          ['style', 'color: blue'],
        ]),
      ],
      node
    );
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('map');
    expect(backend.call('LexicalNode.getStyle', [], node)).toBe('color: blue');
    const invalid = new Map();
    Object.defineProperty(invalid, Symbol.iterator, {
      value: () => ({
        next() {
          return {
            get done() {
              throw failure;
            },
          };
        },
      }),
    });
    let caught: unknown = 'not thrown';
    try {
      backend.call('LexicalNode.updateFromJSON', [invalid], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('map');
    const args = new Proxy([], {
      get(target, key, receiver) {
        if (key === 'length')
          return {
            valueOf() {
              throw failure;
            },
          };
        return Reflect.get(target, key, receiver);
      },
    });
    caught = 'not thrown';
    try {
      backend.call('lexical.$createTextNode', args);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    backend.call('LexicalNode.setTextContent', ['usable'], node);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
