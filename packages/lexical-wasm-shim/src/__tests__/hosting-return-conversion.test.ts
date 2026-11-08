import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('node-result getters and proxies throw opaquely without leaking the mutable callback lease', () => {
  const hook = foreignHookIndex().indexOf('createParentElementNode');
  const backend = new ConformanceBackend({
    namespace: 'foreign result conversion',
    nodes: [
      {
        type: 'result-conversion',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  const failure = { opaque: 'node result getter' };
  let calls = 0;
  let parent: unknown;
  try {
    backend.installForeign('result-conversion', (message) => {
      calls++;
      if (calls === 1)
        return {
          get $h() {
            throw failure;
          },
        };
      if (calls === 2)
        return {
          nested: {
            get value() {
              throw undefined;
            },
          },
        };
      if (calls === 3)
        return new Proxy(
          {},
          {
            ownKeys() {
              throw failure;
            },
          }
        );
      return {
        get $h() {
          backend.call(
            'LexicalNode.setTextContent',
            ['getter mutation'],
            message.node
          );
          return Reflect.get(Object(parent), '$h');
        },
      };
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'result-conversion',
      {},
    ]);
    parent = backend.call('lexical.$createParagraphNode', []);
    const identity = handles.node(parent);
    let caught: unknown = 'not thrown';
    try {
      backend.call('LexicalNode.createParentElementNode', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    backend.call('LexicalNode.setTextContent', ['after getter'], node);
    caught = 'not thrown';
    try {
      backend.call('LexicalNode.createParentElementNode', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(undefined);
    backend.call('LexicalNode.setTextContent', ['after nested getter'], node);
    caught = 'not thrown';
    try {
      backend.call('LexicalNode.createParentElementNode', [], node);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    backend.call('LexicalNode.setTextContent', ['after proxy'], node);
    expect(
      handles.node(
        backend.call('LexicalNode.createParentElementNode', [], node)
      )
    ).toBe(identity);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe(
      'getter mutation'
    );
    backend.commit();
  } finally {
    backend.dispose();
  }
});
