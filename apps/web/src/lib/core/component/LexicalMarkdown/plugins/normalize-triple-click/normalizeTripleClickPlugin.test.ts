import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
  QuoteNode,
  registerRichText,
} from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  createEditor,
  type LexicalEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import {
  $fixFocusOverselection,
  normalizeTripleClickPlugin,
} from './normalizeTripleClickPlugin';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'normalize-triple-click-plugin-test',
    nodes: [HeadingNode, ParagraphNode, QuoteNode, TextNode],
    onError: (error) => {
      throw error;
    },
  });

  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  registerRichText(editor);
  normalizeTripleClickPlugin()(editor);

  return editor;
}

/**
 * Builds a heading followed by a paragraph and returns the keys of their text
 * nodes. The nodes are committed in their own update so the DOM is reconciled
 * before we manipulate the selection (mirroring a real triple-click, where the
 * blocks already exist in the DOM).
 */
function seedHeadingAndParagraph(editor: LexicalEditor): {
  headingTextKey: string;
  paragraphTextKey: string;
} {
  let headingTextKey = '';
  let paragraphTextKey = '';

  editor.update(
    () => {
      const heading = $createHeadingNode('h1');
      const headingText = $createTextNode('Header');
      heading.append(headingText);
      headingTextKey = headingText.getKey();

      const paragraph = $createParagraphNode();
      const paragraphText = $createTextNode('Paragraph');
      paragraph.append(paragraphText);
      paragraphTextKey = paragraphText.getKey();

      $getRoot().clear().append(heading).append(paragraph);
    },
    { discrete: true }
  );

  return { headingTextKey, paragraphTextKey };
}

/**
 * Simulate the browser triple-click over-selection: the selection covers the
 * whole heading but the focus spills into offset 0 of the next block.
 */
function selectOverBlockBoundary(
  headingTextKey: string,
  paragraphTextKey: string
): void {
  const selection = $createRangeSelection();
  selection.anchor.set(headingTextKey, 0, 'text');
  selection.focus.set(paragraphTextKey, 0, 'text');
  $setSelection(selection);
}

describe('normalizeTripleClickPlugin', () => {
  test('pulls an over-selected focus back to the end of the selected block', () => {
    const editor = createTestEditor();
    const { headingTextKey, paragraphTextKey } =
      seedHeadingAndParagraph(editor);

    let focusKey = '';
    let focusOffset = -1;

    editor.update(
      () => {
        selectOverBlockBoundary(headingTextKey, paragraphTextKey);

        $fixFocusOverselection();

        const fixedSelection = $getSelection();
        if (!$isRangeSelection(fixedSelection)) return;
        focusKey = fixedSelection.focus.key;
        focusOffset = fixedSelection.focus.offset;
      },
      { discrete: true }
    );

    // Focus should now land at the end of the heading text, not the start of
    // the paragraph.
    expect(focusKey).toBe(headingTextKey);
    expect(focusOffset).toBe('Header'.length);
  });

  test('deleting a triple-selected heading does not restyle the paragraph below', () => {
    const editor = createTestEditor();
    const { headingTextKey, paragraphTextKey } =
      seedHeadingAndParagraph(editor);

    editor.update(
      () => {
        selectOverBlockBoundary(headingTextKey, paragraphTextKey);

        $fixFocusOverselection();

        const fixedSelection = $getSelection();
        if (!$isRangeSelection(fixedSelection)) return;
        fixedSelection.removeText();
      },
      { discrete: true }
    );

    editor.read(() => {
      const paragraph = $getRoot()
        .getChildren()
        .find((node) => node.getTextContent() === 'Paragraph');
      expect(paragraph).toBeDefined();
      // The paragraph must remain a paragraph rather than inheriting the
      // heading style from a block merge.
      expect($isParagraphNode(paragraph)).toBe(true);
      expect($isHeadingNode(paragraph)).toBe(false);
    });
  });
});
