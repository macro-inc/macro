// @vitest-environment jsdom
import * as Original from 'lexical';
import { expect, test } from 'vitest';
import { $createParagraphNode, createEditor } from '../../index';
import { $setDirectionFromDOM, setNodeIndentFromDOM } from '../dom-config';

test('actual indent and direction preserve authoritative attributes and getter failures', () => {
  const original = Original.createEditor({
    onError(error) {
      throw error;
    },
  });
  const dom = document.createElement('p');
  dom.setAttribute('data-lexical-indent', '3');
  dom.setAttribute('dir', 'rtl');
  Object.defineProperty(dom.style, 'paddingInlineStart', {
    get() {
      throw new Error('padding must not be read');
    },
  });
  let expected: unknown;
  original.update(
    () => {
      const node = Original.$createParagraphNode();
      Original.setNodeIndentFromDOM(dom, node);
      const result = Original.$setDirectionFromDOM(node, dom);
      expected = [node.getIndent(), node.getDirection(), result === node];
    },
    { discrete: true }
  );
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  try {
    editor.update(() => {
      const node = $createParagraphNode();
      setNodeIndentFromDOM(dom, node);
      const result = $setDirectionFromDOM(node, dom);
      expect([node.getIndent(), node.getDirection(), result === node]).toEqual(
        expected
      );
      const opaque = { reason: 'attribute getter' };
      dom.getAttribute = () => {
        throw opaque;
      };
      let received: unknown;
      try {
        $setDirectionFromDOM(node, dom);
      } catch (error) {
        received = error;
      }
      expect(received).toBe(opaque);
      expect(node.getDirection()).toBe('rtl');
    });
  } finally {
    editor.dispose();
  }
});
