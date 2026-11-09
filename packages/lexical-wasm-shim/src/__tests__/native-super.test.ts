import { expect, test } from 'vitest';
import { ConformanceBackend } from '../backend/conformance';
import { NodeHandles } from '../handles';

test('indexed native-super operations retain native receiver identities and UTF-16 mutations', () => {
  const backend = new ConformanceBackend({
    namespace: 'native calls',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const text = backend.call('lexical.$createTextNode', ['a😀b']);
    const handles = new NodeHandles(backend, (id) => ({ id }));
    const paragraph = handles.node(p);
    const textNode = handles.node(text);
    expect(
      handles.node(backend.callNative('LexicalNode.append', [text], p))
    ).toBe(paragraph);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    expect(() =>
      backend.callNative('LexicalNode.spliceText', [2, 0, 'x'], text)
    ).toThrow('UTF-16');
    expect(
      handles.node(
        backend.callNative('LexicalNode.spliceText', [1, 2, 'z'], text)
      )
    ).toBe(textNode);
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe('azb');
    expect(() => backend.callNative('LexicalNode.getLatest', [], text)).toThrow(
      'native-super requires a node hook API'
    );
    backend.callNative('LexicalNode.setTextContent', ['after error'], text);
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe(
      'after error'
    );
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('real JS transform reentry can invoke indexed native-super without losing its mutable frame', () => {
  const backend = new ConformanceBackend({
    namespace: 'native transform',
    nodes: [],
  });
  let calls = 0;
  try {
    backend.registerTransform('text', (node) => {
      calls++;
      if (backend.call('LexicalNode.getTextContent', [], node) === 'lower')
        backend.callNative('LexicalNode.setTextContent', ['UPPER'], node);
    });
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const text = backend.call('lexical.$createTextNode', ['lower']);
    backend.call('LexicalNode.append', [text], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.flush();
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe('UPPER');
    expect(calls).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
