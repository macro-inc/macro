import {
  $isListNode,
  ListItemNode,
  ListNode,
  registerList,
} from '@lexical/list';
import {
  CHECK_LIST,
  HEADING,
  ORDERED_LIST,
  QUOTE,
  UNORDERED_LIST,
} from '@lexical/markdown';
import {
  $isHeadingNode,
  $isQuoteNode,
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
  $isTextNode,
  COMPOSITION_END_TAG,
  createEditor,
  type LexicalEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import { markdownShortcutsPlugin } from './markdownShortcutsPlugin';
import { trailingAcceptanceCaret } from './mobileTextCommit';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'markdown-shortcuts-mobile-test',
    nodes: [
      ParagraphNode,
      TextNode,
      ListNode,
      ListItemNode,
      HeadingNode,
      QuoteNode,
    ],
    onError: (error) => {
      throw error;
    },
  });

  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  registerRichText(editor);
  registerList(editor);
  markdownShortcutsPlugin({
    transformers: [UNORDERED_LIST, CHECK_LIST, ORDERED_LIST, HEADING, QUOTE],
    triggerOnEnterTransformers: [],
  })(editor);
  return editor;
}

function seedEmptyParagraph(editor: LexicalEditor) {
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      const text = $createTextNode('');
      paragraph.append(text);
      $getRoot().clear().append(paragraph);
      text.select(0, 0);
    },
    { discrete: true }
  );
}

function insert(editor: LexicalEditor, value: string) {
  editor.update(
    () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(value);
    },
    { discrete: true }
  );
}

function readBlock(editor: LexicalEditor) {
  return editor.read(() => {
    const block = $getRoot().getFirstChild();
    const selection = $getSelection();
    return {
      heading: block ? $isHeadingNode(block) : false,
      listType: $isListNode(block) ? block.getListType() : null,
      offset: $isRangeSelection(selection) ? selection.anchor.offset : null,
      quote: block ? $isQuoteNode(block) : false,
      text: $getRoot().getTextContent(),
      type: block?.getType() ?? null,
    };
  });
}

describe('markdown shortcuts under mobile text insertion', () => {
  test('a single space after a dash becomes a bullet', () => {
    const editor = createTestEditor();
    seedEmptyParagraph(editor);
    insert(editor, '-');
    insert(editor, ' ');

    expect(readBlock(editor)).toMatchObject({ listType: 'bullet', text: '' });
  });

  test('a glide or suggestion commit of "- " becomes a bullet', () => {
    const editor = createTestEditor();
    seedEmptyParagraph(editor);
    insert(editor, '- ');

    expect(readBlock(editor)).toMatchObject({ listType: 'bullet', text: '' });
  });

  test('a second space still becomes a bullet when the first one did not', () => {
    const editor = createTestEditor();
    seedEmptyParagraph(editor);
    insert(editor, '-');
    insert(editor, '  ');

    expect(readBlock(editor)).toMatchObject({ listType: 'bullet', text: '' });
  });

  test('composition that leaves the caret before the shortcut space becomes a bullet', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('- ');
        paragraph.append(text);
        $getRoot().clear().append(paragraph);
        text.select(1, 1);
      },
      { discrete: true, tag: COMPOSITION_END_TAG }
    );

    expect(readBlock(editor)).toMatchObject({ listType: 'bullet', text: '' });
  });

  test('a multi-character heading or quote marker still converts', () => {
    const heading = createTestEditor();
    seedEmptyParagraph(heading);
    insert(heading, '# ');
    expect(readBlock(heading).heading).toBe(true);

    const quote = createTestEditor();
    seedEmptyParagraph(quote);
    insert(quote, '> ');
    expect(readBlock(quote).quote).toBe(true);

    const numbered = createTestEditor();
    seedEmptyParagraph(numbered);
    insert(numbered, '1. ');
    expect(readBlock(numbered).listType).toBe('number');
  });

  test('a checklist marker inserted in one commit becomes a checklist', () => {
    const editor = createTestEditor();
    seedEmptyParagraph(editor);
    insert(editor, '- [ ] ');

    expect(readBlock(editor)).toMatchObject({ listType: 'check', text: '' });
  });

  test('a sentence that merely contains a dash stays text', () => {
    const editor = createTestEditor();
    seedEmptyParagraph(editor);
    insert(editor, '- hello ');

    expect(readBlock(editor)).toMatchObject({
      listType: null,
      text: '- hello ',
      type: 'paragraph',
    });
  });

  test('a glide commit that leaves the caret on the trailing space moves past it', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('hel');
        paragraph.append(text);
        $getRoot().clear().append(paragraph);
        text.select(3, 3);
      },
      { discrete: true }
    );
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isParagraphNode(paragraph)) throw new Error('expected paragraph');
        const text = paragraph.getFirstChild();
        if (!$isTextNode(text)) throw new Error('expected text');
        text.setTextContent('hello ');
        text.select(5, 5);
      },
      { discrete: true }
    );

    expect(readBlock(editor)).toMatchObject({
      offset: 6,
      text: 'hello ',
      type: 'paragraph',
    });
  });
});

describe('trailingAcceptanceCaret', () => {
  test('steps over the space a multi-character commit left the caret on', () => {
    expect(
      trailingAcceptanceCaret(
        { key: 'a', offset: 0, text: '' },
        { key: 'a', offset: 5, text: 'hello ' }
      )
    ).toBe(6);
  });

  test('leaves a caret that is already past the space', () => {
    expect(
      trailingAcceptanceCaret(
        { key: 'a', offset: 0, text: '' },
        { key: 'a', offset: 6, text: 'hello ' }
      )
    ).toBeNull();
  });

  test('ignores a single typed space', () => {
    expect(
      trailingAcceptanceCaret(
        { key: 'a', offset: 5, text: 'hello' },
        { key: 'a', offset: 5, text: 'hello ' }
      )
    ).toBeNull();
  });
});
