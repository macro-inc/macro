import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
  QuoteNode,
  registerRichText,
} from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  createEditor,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import { normalizeEnterPlugin } from './normalizeEnterPlugin';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'normalize-enter-plugin-test',
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
  normalizeEnterPlugin()(editor);

  return editor;
}

const waitForStyleCleanup = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('normalizeEnterPlugin', () => {
  test('splits heading text into a following paragraph', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const heading = $createHeadingNode('h2');
        const text = $createTextNode('HelloWorld');
        heading.append(text);
        $getRoot().clear().append(heading);
        text.select(5, 5);
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' })
    );

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(2);
      expect($isHeadingNode(children[0])).toBe(true);
      expect(children[0].getTextContent()).toBe('Hello');
      expect($isParagraphNode(children[1])).toBe(true);
      expect(children[1].getTextContent()).toBe('World');
    });
  });

  test('clears pending inline styles for an empty paragraph after a heading', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const heading = $createHeadingNode('h2');
        const text = $createTextNode('Hello').setFormat('bold');
        heading.append(text);
        $getRoot().clear().append(heading);
        text.select(5, 5);

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        selection.setFormat(text.getFormat());
        selection.setStyle('color: red;');
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' })
    );

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(2);
      expect($isParagraphNode(children[1])).toBe(true);
      expect(children[1].getTextContent()).toBe('');

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.anchor.getNode().getTopLevelElement()?.getKey()).toBe(
        children[1].getKey()
      );
      expect(selection.format).toBe(0);
      expect(selection.style).toBe('');
    });
  });

  test('clears pending inline styles for an empty paragraph after a paragraph', async () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Hello').setFormat('bold');
        paragraph.append(text);
        $getRoot().clear().append(paragraph);
        text.select(5, 5);

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        selection.setFormat(text.getFormat());
        selection.setStyle('color: red;');
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      new KeyboardEvent('keydown', { key: 'Enter' })
    );
    await waitForStyleCleanup();

    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children).toHaveLength(2);
      expect($isParagraphNode(children[1])).toBe(true);
      expect(children[1].getTextContent()).toBe('');

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.anchor.getNode().getTopLevelElement()?.getKey()).toBe(
        children[1].getKey()
      );
      expect(selection.format).toBe(0);
      expect(selection.style).toBe('');
    });
  });
});
