import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  createEditor,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from '../node-transform/nodeTransformPlugin';
import {
  keyboardShortcutsPlugin,
  ListAndQuoteShortcuts,
} from './keyboardShortcutsPlugin';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'keyboard-shortcuts-plugin-test',
    nodes: [ParagraphNode, TextNode],
    onError: (error) => {
      throw error;
    },
  });

  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  keyboardShortcutsPlugin({ shortcuts: [] })(editor);

  return editor;
}

describe('keyboardShortcutsPlugin', () => {
  test('right arrow escapes inline code and inserts a trailing space', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const codeText = $createTextNode('code').setFormat('code');
        paragraph.append(codeText);
        $getRoot().clear().append(paragraph);
        codeText.select(4, 4);

        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.setFormat(codeText.getFormat());
        }
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ARROW_RIGHT_COMMAND,
      new KeyboardEvent('keydown', { key: 'ArrowRight' })
    );

    editor.read(() => {
      expect($getRoot().getTextContent()).toBe('code ');

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.hasFormat('code')).toBe(false);
      expect(selection.anchor.getNode().getTextContent()).toBe(' ');
      expect(selection.anchor.offset).toBe(1);
    });
  });

  test('right arrow escapes inline code and moves past an existing trailing space', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const codeText = $createTextNode('code').setFormat('code');
        const spaceText = $createTextNode(' ');
        paragraph.append(codeText, spaceText);
        $getRoot().clear().append(paragraph);
        codeText.select(4, 4);

        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.setFormat(codeText.getFormat());
        }
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ARROW_RIGHT_COMMAND,
      new KeyboardEvent('keydown', { key: 'ArrowRight' })
    );

    editor.read(() => {
      expect($getRoot().getTextContent()).toBe('code ');

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.hasFormat('code')).toBe(false);
      expect(selection.anchor.getNode().getTextContent()).toBe(' ');
      expect(selection.anchor.offset).toBe(1);
    });
  });

  test('right arrow inserts a space when the caret is at the start of text after inline code', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const codeText = $createTextNode('code').setFormat('code');
        const nextText = $createTextNode('after');
        paragraph.append(codeText, nextText);
        $getRoot().clear().append(paragraph);
        nextText.select(0, 0);
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ARROW_RIGHT_COMMAND,
      new KeyboardEvent('keydown', { key: 'ArrowRight' })
    );

    editor.read(() => {
      expect($getRoot().getTextContent()).toBe('code after');

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.anchor.getNode().getTextContent()).toBe(' after');
      expect(selection.anchor.offset).toBe(1);
    });
  });

  test('right arrow moves past a space from an element boundary after inline code', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const codeText = $createTextNode('code').setFormat('code');
        const spaceText = $createTextNode(' ');
        paragraph.append(codeText, spaceText);
        $getRoot().clear().append(paragraph);
        paragraph.select(1, 1);
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ARROW_RIGHT_COMMAND,
      new KeyboardEvent('keydown', { key: 'ArrowRight' })
    );

    editor.read(() => {
      expect($getRoot().getTextContent()).toBe('code ');

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.anchor.getNode().getTextContent()).toBe(' ');
      expect(selection.anchor.offset).toBe(1);
    });
  });

  test('right arrow inserts a space when selection format is clear at the end of inline code', () => {
    const editor = createTestEditor();

    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const codeText = $createTextNode('code').setFormat('code');
        paragraph.append(codeText);
        $getRoot().clear().append(paragraph);
        codeText.select(4, 4);

        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.setFormat(0);
        }
      },
      { discrete: true }
    );

    editor.dispatchCommand(
      KEY_ARROW_RIGHT_COMMAND,
      new KeyboardEvent('keydown', { key: 'ArrowRight' })
    );

    editor.read(() => {
      expect($getRoot().getTextContent()).toBe('code ');

      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.hasFormat('code')).toBe(false);
      expect(selection.anchor.getNode().getTextContent()).toBe(' ');
      expect(selection.anchor.offset).toBe(1);
    });
  });
});

describe('ListAndQuoteShortcuts', () => {
  test.each([
    ['Digit7', 'list-number'],
    ['Digit8', 'list-bullet'],
    ['Digit9', 'quote'],
  ] as const)('mod+shift+%s formats the block as %s', (code, transform) => {
    const editor = createTestEditor();
    keyboardShortcutsPlugin({ shortcuts: ListAndQuoteShortcuts })(editor);
    const dispatched: NodeTransformType[] = [];
    editor.registerCommand(
      NODE_TRANSFORM,
      (payload) => {
        dispatched.push(payload);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const press = (init: KeyboardEventInit) =>
      editor.dispatchCommand(
        KEY_DOWN_COMMAND,
        new KeyboardEvent('keydown', { code, ...init })
      );

    // Without the shift modifier the digit is left to the editor.
    press({ metaKey: true, ctrlKey: true });
    expect(dispatched).toEqual([]);

    press({ shiftKey: true, metaKey: true, ctrlKey: true });
    expect(dispatched).toEqual([transform]);
  });
});
