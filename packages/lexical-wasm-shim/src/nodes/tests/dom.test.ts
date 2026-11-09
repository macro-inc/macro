// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { DEFAULT_EDITOR_DOM_CONFIG } from '../../editor-dom-config';
import { ParagraphNode, TextNode } from '../index';

test('text DOM preserves nested formatting, theme combinations and styles across updates', () => {
  let slotCalls = 0;
  const editor = createEditor({
    dom: {
      $getDOMSlot: (node, dom, activeEditor) => {
        slotCalls++;
        return DEFAULT_EDITOR_DOM_CONFIG.$getDOMSlot(node, dom, activeEditor);
      },
    },
    namespace: 'node DOM',
    onError: (error) => {
      throw error;
    },
  });
  let previous: TextNode | undefined;
  let dom: HTMLElement | undefined;
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
    editor.update(
      () => {
        const text = new TextNode('before')
          .setFormat('bold')
          .setStyle('color: red');
        $getRoot().append(new ParagraphNode().append(text));
        dom = text.createDOM(config, editor);
        expect(dom.outerHTML).toBe(
          '<strong class="bold" style="color: red;">before</strong>'
        );
        expect(slotCalls).toBeGreaterThan(0);
        previous = text.getLatest();
      },
      { discrete: true }
    );
    editor.update(
      () => {
        if (previous === undefined || dom === undefined)
          throw new Error('missing DOM fixture');
        const next = previous
          .setTextContent('after')
          .toggleFormat('underline')
          .toggleFormat('strikethrough')
          .setStyle('background-color: blue');
        expect(next.updateDOM(previous, dom, config)).toBe(false);
        expect(dom.textContent).toBe('after');
        expect(dom.className).toBe('bold combined');
        expect(dom.style.color).toBe('');
        expect(dom.style.backgroundColor).toBe('blue');
        expect(next.toggleFormat('bold').updateDOM(previous, dom, config)).toBe(
          true
        );
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});

test('paragraph import preserves authoritative indent, direction and legacy alignment', () => {
  const editor = createEditor({ namespace: 'node import' });
  try {
    editor.update(
      () => {
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
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});
