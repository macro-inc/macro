import { registerRichText } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { describe, expect, test, vi } from 'vitest';
import { nativeIosBackspacePlugin } from './nativeIosBackspacePlugin';

vi.mock('lexical', async (importOriginal) => ({
  ...(await importOriginal<typeof import('lexical')>()),
  IS_IOS: true,
}));

function createTestEditor(text: string, offset: number) {
  const editor = createEditor({
    namespace: 'native-ios-backspace-test',
    nodes: [ParagraphNode, TextNode],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  registerRichText(editor);
  nativeIosBackspacePlugin()(editor);
  editor.update(
    () => {
      const node = $createTextNode(text);
      $getRoot().clear().append($createParagraphNode().append(node));
      node.select(offset, offset);
    },
    { discrete: true }
  );
  return { editor, root };
}

function pressBackspace(root: HTMLElement) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Backspace',
  });
  root.dispatchEvent(event);
  return event;
}

function readText(editor: LexicalEditor) {
  return editor.read(() => $getRoot().getTextContent());
}

describe('nativeIosBackspacePlugin', () => {
  test('leaves a Backspace inside text to the iOS keyboard', () => {
    const { editor, root } = createTestEditor('hello world', 11);

    expect(pressBackspace(root).defaultPrevented).toBe(false);
    expect(readText(editor)).toBe('hello world');
  });

  test('keeps Lexical handling at the start of a block', () => {
    // jsdom has no Selection.modify, which Lexical's delete path calls.
    Selection.prototype.modify ??= () => {};
    const { root } = createTestEditor('hello', 0);

    expect(pressBackspace(root).defaultPrevented).toBe(true);
  });
});
