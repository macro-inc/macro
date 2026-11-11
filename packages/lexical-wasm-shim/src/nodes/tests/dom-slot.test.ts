// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { DOMSlot } from '../../../../lexical-wasm-view/src/compat/dom-slot';
import { $getRoot, createEditor } from '../../editor';
import { ParagraphNode, TextNode } from '../index';

test('actual text DOM updates preserve a custom slot leading toolbar', () => {
  const slotOverride = vi
    .spyOn(TextNode.prototype, 'getDOMSlot')
    .mockImplementation((element) => {
      let toolbar = element.querySelector(':scope > .node-toolbar');
      if (toolbar === null) {
        toolbar = element.ownerDocument.createElement('span');
        toolbar.className = 'node-toolbar';
        toolbar.setAttribute('contenteditable', 'false');
        toolbar.textContent = 'toolbar';
        element.insertBefore(toolbar, element.firstChild);
      }
      return new DOMSlot(element).withAfter(toolbar);
    });
  try {
    const editor = createEditor({
      namespace: 'text slot',
      onError: (error) => {
        throw error;
      },
    });
    let previous: TextNode | undefined;
    let dom: HTMLElement | undefined;
    let toolbar: ChildNode | null | undefined;
    try {
      editor.update(
        () => {
          const text = new TextNode('before');
          $getRoot().append(new ParagraphNode().append(text));
          previous = text.getLatest();
          dom = text.createDOM(editor._config, editor);
          toolbar = dom.firstChild;
          expect(toolbar?.textContent).toBe('toolbar');
          expect(toolbar?.nextSibling?.nodeValue).toBe('before');
        },
        { discrete: true }
      );
      editor.update(
        () => {
          if (previous === undefined || dom === undefined)
            throw new Error('missing committed text fixture');
          const next = previous.setTextContent('after');
          expect(next.updateDOM(previous, dom, editor._config)).toBe(false);
          expect(dom.firstChild).toBe(toolbar);
          expect(dom.childNodes.length).toBe(2);
          expect(toolbar?.textContent).toBe('toolbar');
          expect(toolbar?.nextSibling?.nodeValue).toBe('after');
          expect(slotOverride).toHaveBeenCalledTimes(2);
        },
        { discrete: true }
      );
    } finally {
      editor.dispose();
    }
  } finally {
    slotOverride.mockRestore();
  }
});
