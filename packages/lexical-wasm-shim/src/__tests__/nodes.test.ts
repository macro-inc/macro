import { expect, test } from 'vitest';
import { ConformanceBackend } from '../backend/conformance';
import {
  ElementNode,
  nativeNode,
  ParagraphNode,
  RootNode,
  TextNode,
} from '../nodes';
import { NodeRuntime, nodeField, withNodeRuntime } from '../nodes/runtime';

test('native JS nodes share model identities and preserve captured fields across writes', () => {
  const backend = new ConformanceBackend({ namespace: 'native facade' });
  const runtime = new NodeRuntime(backend, nativeNode);
  try {
    withNodeRuntime(runtime, () => {
      backend.beginUpdate([], false);
      const root = runtime.call('lexical.$getRoot', []);
      const paragraph = runtime.call('lexical.$createParagraphNode', []);
      const text = runtime.call('lexical.$createTextNode', ['before']);
      if (
        !(root instanceof RootNode) ||
        !(paragraph instanceof ParagraphNode) ||
        !(text instanceof TextNode)
      )
        throw new Error('native classes were not hydrated');
      expect(paragraph).toBeInstanceOf(ElementNode);
      expect(text.getKey()).toBe('2');
      expect(root.getKey()).toBe('root');
      paragraph.append(text);
      root.append(paragraph);
      expect(root.getChildren()[0]).toBe(paragraph);
      expect(paragraph.getChildren()[0]).toBe(text);
      expect(text.getParent()).toBe(paragraph);
      expect(text.getLatest()).toBe(text);
      const committedRoot = root.getLatest();
      backend.commit();
      expect(nodeField(text, '__text')).toBe('before');
      backend.beginUpdate([], false);
      const changed = text.setTextContent('after');
      expect(changed).not.toBe(text);
      expect(text.getLatest()).toBe(changed);
      expect(text.getWritable()).toBe(changed);
      expect(changed.getWritable()).toBe(changed);
      expect(changed.getKey()).toBe(text.getKey());
      expect(nodeField(text, '__text')).toBe('before');
      expect(nodeField(changed, '__text')).toBe('after');
      expect(text.getTextContent()).toBe('after');
      backend.commit();
      backend.readState('1', () => {
        expect(text.getTextContent()).toBe('before');
        expect(runtime.call('lexical.$getRoot', [])).toBe(committedRoot);
      });
    });
  } finally {
    backend.dispose();
  }
});

test('native node calls reject nodes owned by a different editor before crossing', () => {
  const first = new ConformanceBackend({ namespace: 'first native facade' });
  const second = new ConformanceBackend({ namespace: 'second native facade' });
  const left = new NodeRuntime(first, nativeNode);
  const right = new NodeRuntime(second, nativeNode);
  try {
    first.beginUpdate([], false);
    const paragraph = left.call('lexical.$createParagraphNode', []);
    second.beginUpdate([], false);
    const text = right.call('lexical.$createTextNode', ['other']);
    if (!(paragraph instanceof ParagraphNode) || !(text instanceof TextNode))
      throw new Error('native classes were not hydrated');
    expect(() => withNodeRuntime(left, () => paragraph.append(text))).toThrow(
      'Lexical node does not exist in active editor state'
    );
    expect(withNodeRuntime(left, () => paragraph.getChildrenSize())).toBe(0);
    expect(withNodeRuntime(right, () => text.getParent())).toBeNull();
    second.discard();
    first.discard();
  } finally {
    second.dispose();
    first.dispose();
  }
});
