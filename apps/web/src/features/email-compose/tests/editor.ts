import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';

export function createEmailEditor(text = '') {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError(error) {
      throw error;
    },
  });
  setEmailEditorText(editor, text);
  return editor;
}

export function setEmailEditorText(editor: LexicalEditor, text: string) {
  editor.update(
    () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode(text)));
    },
    { discrete: true }
  );
}
