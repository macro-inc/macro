import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list';
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from '@lexical/rich-text';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createHasMultilineStructure } from './create-has-multiline-structure';

describe('composer multiline structure', () => {
  it.each([
    [
      'bullet list',
      () => $createListNode('bullet').append($createListItemNode()),
    ],
    [
      'numbered list',
      () => $createListNode('number').append($createListItemNode()),
    ],
    ['checklist', () => $createListNode('check').append($createListItemNode())],
    ['blockquote', $createQuoteNode],
    ['heading', () => $createHeadingNode('h2')],
  ] as const)(
    'expands a short %s and compacts when converted back to a paragraph',
    (_name, createBlock) => {
      createRoot((dispose) => {
        const editor = createEditor({
          nodes: [ListNode, ListItemNode, QuoteNode, HeadingNode],
        });
        const hasMultilineStructure = createHasMultilineStructure(editor);
        editor.update(
          () =>
            $getRoot().append(
              $createParagraphNode().append($createTextNode('Short'))
            ),
          { discrete: true }
        );
        expect(hasMultilineStructure()).toBe(false);

        editor.update(
          () => {
            const block = createBlock();
            const textContainer = block.getFirstChild() ?? block;
            if (textContainer instanceof ListItemNode) {
              textContainer.append($createTextNode('Short'));
            } else {
              block.append($createTextNode('Short'));
            }
            $getRoot().clear().append(block);
          },
          { discrete: true }
        );
        expect(
          editor.getEditorState().read(() => $getRoot().getTextContent())
        ).toBe('Short');
        expect(hasMultilineStructure()).toBe(true);

        editor.update(
          () =>
            $getRoot()
              .clear()
              .append($createParagraphNode().append($createTextNode('Short'))),
          { discrete: true }
        );
        expect(hasMultilineStructure()).toBe(false);
        dispose();
      });
    }
  );

  it('keeps inline formatting in a single paragraph compact', () => {
    createRoot((dispose) => {
      const editor = createEditor();
      const hasMultilineStructure = createHasMultilineStructure(editor);
      expect(hasMultilineStructure()).toBe(false);
      editor.update(
        () =>
          $getRoot().append(
            $createParagraphNode().append(
              $createTextNode('Bold').toggleFormat('bold'),
              $createTextNode('Italic').toggleFormat('italic'),
              $createTextNode('Code').toggleFormat('code')
            )
          ),
        { discrete: true }
      );
      expect(hasMultilineStructure()).toBe(false);
      dispose();
    });
  });

  it('expands an empty blockquote restored before the observer starts', () => {
    createRoot((dispose) => {
      const editor = createEditor({ nodes: [QuoteNode] });
      editor.update(() => $getRoot().append($createQuoteNode()), {
        discrete: true,
      });
      const hasMultilineStructure = createHasMultilineStructure(editor);
      expect(hasMultilineStructure()).toBe(true);
      dispose();
    });
  });

  it('expands for blank paragraphs and collapses when they are removed', () => {
    createRoot((dispose) => {
      const editor = createEditor();
      const hasMultilineStructure = createHasMultilineStructure(editor);
      editor.update(() => $getRoot().append($createParagraphNode()), {
        discrete: true,
      });
      expect(hasMultilineStructure()).toBe(false);
      editor.update(() => $getRoot().append($createParagraphNode()), {
        discrete: true,
      });
      expect(hasMultilineStructure()).toBe(true);
      editor.update(() => $getRoot().clear().append($createParagraphNode()), {
        discrete: true,
      });
      expect(hasMultilineStructure()).toBe(false);
      dispose();
    });
  });

  it('detects a trailing soft break before another character is typed', () => {
    createRoot((dispose) => {
      const editor = createEditor();
      const hasMultilineStructure = createHasMultilineStructure(editor);
      editor.update(
        () =>
          $getRoot().append(
            $createParagraphNode().append(
              $createTextNode('Hello'),
              $createLineBreakNode()
            )
          ),
        { discrete: true }
      );
      expect(hasMultilineStructure()).toBe(true);
      dispose();
    });
  });
});
