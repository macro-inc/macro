// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { $getRoot, createEditor } from '../../editor';
import { ParagraphNode, TextNode } from '../index';

test('text DOM creation and export honor the public format predicate override', () => {
  const editor = createEditor({
    namespace: 'DOM format predicates',
    onError: (error) => {
      throw error;
    },
  });
  try {
    editor.update(
      () => {
        const text = new TextNode('text');
        $getRoot().append(new ParagraphNode().append(text));
        text.hasFormat = (format) => format === 'code' || format === 'bold';
        const created = text.createDOM(editor._config, editor);
        const { element } = text.exportDOM(editor);
        if (!(element instanceof HTMLElement))
          throw new Error('expected exported text element');
        expect({
          createdTag: created.tagName,
          spellcheck: created.getAttribute('spellcheck'),
          exportTag: element.tagName,
          exportedInnerTag: element.firstElementChild?.tagName,
        }).toEqual({
          createdTag: 'SPAN',
          spellcheck: 'false',
          exportTag: 'B',
          exportedInnerTag: 'SPAN',
        });
        expect(element.textContent).toBe('text');
      },
      { discrete: true }
    );
  } finally {
    editor.dispose();
  }
});
