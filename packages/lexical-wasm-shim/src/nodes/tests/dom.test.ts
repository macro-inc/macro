// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { ConformanceBackend } from '../../backend/conformance';
import { nativeNode, ParagraphNode, RootNode, TextNode } from '../index';
import { NodeRuntime, withNodeRuntime } from '../runtime';

test('text DOM preserves nested formatting, theme combinations and styles across updates', () => {
  const backend = new ConformanceBackend({ namespace: 'node DOM' });
  const runtime = new NodeRuntime(backend, nativeNode);
  const config = {
    namespace: 'node DOM',
    theme: {
      text: {
        bold: 'bold',
        italic: 'italic',
        underline: 'underline',
        strikethrough: 'strike',
        underlineStrikethrough: 'combined',
      },
    },
  };
  try {
    withNodeRuntime(runtime, () => {
      backend.beginUpdate([], false);
      const text = new TextNode('before')
        .setFormat('bold')
        .setStyle('color: red');
      const paragraph = new ParagraphNode().append(text);
      const root = runtime.call('lexical.$getRoot', []);
      if (!(root instanceof RootNode)) throw new Error('expected root');
      root.append(paragraph);
      const dom = text.createDOM(config);
      expect(dom.outerHTML).toBe(
        '<strong class="bold" style="color: red;">before</strong>'
      );
      const old = text.getLatest();
      backend.commit();
      backend.beginUpdate([], false);
      const next = text
        .setTextContent('after')
        .toggleFormat('underline')
        .toggleFormat('strikethrough')
        .setStyle('background-color: blue');
      expect(next.updateDOM(old, dom, config)).toBe(false);
      expect(dom.textContent).toBe('after');
      expect(dom.className).toBe('bold combined');
      expect(dom.style.color).toBe('');
      expect(dom.style.backgroundColor).toBe('blue');
      expect(next.toggleFormat('bold').updateDOM(old, dom, config)).toBe(true);
      backend.discard();
    });
  } finally {
    backend.dispose();
  }
});

test('paragraph import preserves authoritative indent, direction and legacy alignment', () => {
  const backend = new ConformanceBackend({ namespace: 'node import' });
  const runtime = new NodeRuntime(backend, nativeNode);
  try {
    withNodeRuntime(runtime, () => {
      backend.beginUpdate([], false);
      const element = document.createElement('p');
      element.setAttribute('align', 'right');
      element.setAttribute('dir', 'rtl');
      element.setAttribute('data-lexical-indent', '3');
      element.style.paddingInlineStart = 'calc(3 * 17px)';
      const conversion = ParagraphNode.importDOM()
        ?.p(element)
        ?.conversion(element);
      const node = conversion?.node;
      if (!(node instanceof ParagraphNode))
        throw new Error('expected imported paragraph');
      expect(node.getIndent()).toBe(3);
      expect(node.getDirection()).toBe('rtl');
      expect(node.getFormatType()).toBe('right');
      backend.discard();
    });
  } finally {
    backend.dispose();
  }
});
