import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  DecoratorNode,
  IS_APPLE,
  type LexicalEditor,
  MOVE_TO_END,
  MOVE_TO_START,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import { wordNavigationPlugin } from './wordNavigationPlugin';

class MentionNode extends DecoratorNode<null> {
  static getType() {
    return 'test-mention';
  }

  static clone(node: MentionNode) {
    return new MentionNode(node.__key);
  }

  createDOM() {
    const span = document.createElement('span');
    span.textContent = '@Cursor';
    return span;
  }

  updateDOM() {
    return false;
  }

  decorate() {
    return null;
  }

  isInline() {
    return true;
  }
}

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'word-navigation-plugin-test',
    nodes: [HeadingNode, ParagraphNode, QuoteNode, TextNode, MentionNode],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  registerRichText(editor);
  wordNavigationPlugin()(editor);
  return editor;
}

function selectionPoint() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  return {
    type: selection.anchor.type,
    offset: selection.anchor.offset,
    key: selection.anchor.key,
    nodeType: selection.anchor.getNode().getType(),
  };
}

describe.skipIf(IS_APPLE)('word navigation with a leading mention', () => {
  test('ctrl+left stays on the current word instead of jumping to the block start', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode(
          ' on firefox you will need to download this'
        );
        paragraph.append(new MentionNode(), text);
        $getRoot().clear().append(paragraph);
        text.select(37, 37);
      },
      { discrete: true }
    );

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      ctrlKey: true,
    });
    editor.dispatchCommand(MOVE_TO_START, event);

    expect(event.defaultPrevented).toBe(false);
    editor.read(() => {
      expect(selectionPoint()).toEqual({
        type: 'text',
        offset: 37,
        key: expect.any(String),
        nodeType: 'text',
      });
    });
  });

  test('ctrl+left in ordinary text is left to the browser', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('hello on firefox');
        paragraph.append(text);
        $getRoot().clear().append(paragraph);
        text.select(8, 8);
      },
      { discrete: true }
    );

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      ctrlKey: true,
    });
    editor.dispatchCommand(MOVE_TO_START, event);

    expect(event.defaultPrevented).toBe(false);
    editor.read(() => {
      expect(selectionPoint()?.offset).toBe(8);
      expect(selectionPoint()?.type).toBe('text');
    });
  });

  test('ctrl+left from just after the mention steps in front of it', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode(' on firefox');
        paragraph.append(new MentionNode(), text);
        $getRoot().clear().append(paragraph);
        text.select(0, 0);
      },
      { discrete: true }
    );

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      ctrlKey: true,
    });
    editor.dispatchCommand(MOVE_TO_START, event);

    editor.read(() => {
      expect(selectionPoint()).toMatchObject({
        type: 'element',
        offset: 0,
        nodeType: 'paragraph',
      });
    });
  });

  test('shift+ctrl+left from just after the mention extends back over it', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode(' on firefox');
        paragraph.append(new MentionNode(), text);
        $getRoot().clear().append(paragraph);
        text.select(0, 0);
      },
      { discrete: true }
    );

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      ctrlKey: true,
      shiftKey: true,
    });
    editor.dispatchCommand(MOVE_TO_START, event);

    editor.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error('expected a range');
      expect(selection.anchor).toMatchObject({ type: 'text', offset: 0 });
      expect(selection.focus).toMatchObject({ type: 'element', offset: 0 });
      expect(selection.isCollapsed()).toBe(false);
    });
  });

  test('ctrl+right from before the mention does not jump to the end of the block', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          new MentionNode(),
          $createTextNode(' on firefox you will need to download this')
        );
        $getRoot().clear().append(paragraph);
        paragraph.select(0, 0);
      },
      { discrete: true }
    );

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      ctrlKey: true,
    });
    editor.dispatchCommand(MOVE_TO_END, event);

    expect(event.defaultPrevented).toBe(false);
    editor.read(() => {
      expect(selectionPoint()).toMatchObject({
        type: 'element',
        offset: 0,
        nodeType: 'paragraph',
      });
    });
  });
});
