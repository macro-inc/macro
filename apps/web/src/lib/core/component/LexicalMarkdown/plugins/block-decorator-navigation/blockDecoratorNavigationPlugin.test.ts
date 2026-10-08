import { registerRichText } from '@lexical/rich-text';
import {
  $createDatabaseQueryNode,
  DatabaseQueryNode,
} from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  createEditor,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  $selectDocumentStart,
  blockDecoratorNavigationPlugin,
} from './blockDecoratorNavigationPlugin';

// jsdom has no layout: every element measures as an empty rect at the origin,
// so the caret is on the edge line unless a test places it elsewhere.
const caret = vi.hoisted(() => ({ rect: new DOMRect(0, 0, 0, 0) }));
vi.mock('../../utils', () => ({ $getCaretRect: () => caret.rect }));

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'block-decorator-navigation-test',
    nodes: [ParagraphNode, TextNode, DatabaseQueryNode],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  registerRichText(editor);
  blockDecoratorNavigationPlugin()(editor);
  editor.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('Above')),
          $createDatabaseQueryNode({
            queryId: 'query',
            prompt: 'Open tickets by status',
            displayMode: 'table',
          }),
          $createParagraphNode().append($createTextNode('Below'))
        );
    },
    { discrete: true }
  );
  return editor;
}

const press = (
  editor: LexicalEditor,
  command: typeof KEY_ARROW_DOWN_COMMAND,
  key: string
) => editor.dispatchCommand(command, new KeyboardEvent('keydown', { key }));

function selected(editor: LexicalEditor) {
  return editor.read(() => {
    const selection = $getSelection();
    if ($isNodeSelection(selection))
      return { node: selection.getNodes()[0]?.getType() };
    if ($isRangeSelection(selection))
      return {
        text: selection.anchor.getNode().getTextContent(),
        offset: selection.anchor.offset,
      };
    return null;
  });
}

beforeEach(() => {
  caret.rect = new DOMRect(0, 0, 0, 0);
});

describe('arrow keys across a database answer', () => {
  test('ArrowDown selects the answer, then moves below it', () => {
    const editor = createTestEditor();
    editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd(), {
      discrete: true,
    });

    press(editor, KEY_ARROW_DOWN_COMMAND, 'ArrowDown');
    expect(selected(editor)).toEqual({ node: 'database-query' });

    press(editor, KEY_ARROW_DOWN_COMMAND, 'ArrowDown');
    expect(selected(editor)).toEqual({ text: 'Below', offset: 0 });
  });

  test('ArrowUp selects the answer, then moves above it', () => {
    const editor = createTestEditor();
    editor.update(() => $getRoot().getLastChildOrThrow().selectStart(), {
      discrete: true,
    });

    press(editor, KEY_ARROW_UP_COMMAND, 'ArrowUp');
    expect(selected(editor)).toEqual({ node: 'database-query' });

    press(editor, KEY_ARROW_UP_COMMAND, 'ArrowUp');
    expect(selected(editor)).toMatchObject({ text: 'Above' });
  });

  test('Backspace deletes the selected answer', () => {
    const editor = createTestEditor();
    editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd(), {
      discrete: true,
    });
    press(editor, KEY_ARROW_DOWN_COMMAND, 'ArrowDown');

    press(editor, KEY_BACKSPACE_COMMAND, 'Backspace');
    expect(
      editor.read(() =>
        $getRoot()
          .getChildren()
          .map((node) => node.getType())
      )
    ).toEqual(['paragraph', 'paragraph']);
  });

  test('ArrowDown from a line with more text below it does not select the answer', () => {
    const editor = createTestEditor();
    editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd(), {
      discrete: true,
    });
    caret.rect = new DOMRect(0, -40, 10, 20);

    press(editor, KEY_ARROW_DOWN_COMMAND, 'ArrowDown');
    expect(selected(editor)).not.toEqual({ node: 'database-query' });
  });

  test('ArrowDown from a caret between blocks on the root selects the answer below it', () => {
    const editor = createTestEditor();
    editor.update(() => $getRoot().select(1, 1), { discrete: true });

    press(editor, KEY_ARROW_DOWN_COMMAND, 'ArrowDown');
    expect(selected(editor)).toEqual({ node: 'database-query' });
  });

  test('ArrowUp from a caret between blocks on the root selects the answer above it', () => {
    const editor = createTestEditor();
    editor.update(() => $getRoot().select(2, 2), { discrete: true });

    press(editor, KEY_ARROW_UP_COMMAND, 'ArrowUp');
    expect(selected(editor)).toEqual({ node: 'database-query' });
  });

  test('entering the document from above selects an answer that opens it', () => {
    const editor = createTestEditor();
    editor.update(() => $getRoot().getFirstChildOrThrow().remove(), {
      discrete: true,
    });

    editor.update(() => $selectDocumentStart(), { discrete: true });
    expect(selected(editor)).toEqual({ node: 'database-query' });
  });

  test('entering the document from above puts the caret at the start of its first line', () => {
    const editor = createTestEditor();

    editor.update(() => $selectDocumentStart(), { discrete: true });
    expect(selected(editor)).toEqual({ text: 'Above', offset: 0 });
  });
});
