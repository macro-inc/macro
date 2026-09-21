import {
  $createDocumentMentionNode,
  $createUserMentionNode,
} from '@macro-inc/lexical-core';
import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  DO_SEARCH_COMMAND,
  findAndReplacePlugin,
  type NodekeyOffset,
} from './findAndReplacePlugin';

function createSearchEditor(): {
  editor: LexicalEditor;
  getListOffset: () => NodekeyOffset[];
} {
  const editor = createEditor({
    namespace: 'find-and-replace-plugin-test',
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });

  let listOffset: NodekeyOffset[] = [];
  findAndReplacePlugin({
    getListOffset: () => listOffset,
    setListOffset: (next) => {
      listOffset = next;
    },
  })(editor);

  return {
    editor,
    getListOffset: () => listOffset,
  };
}

describe('findAndReplacePlugin document mentions', () => {
  it('finds a substring in an inline task chip title', () => {
    const { editor, getListOffset } = createSearchEditor();
    let mentionKey = '';

    editor.update(
      () => {
        const mention = $createDocumentMentionNode({
          documentId: 'task-1',
          documentName: 'Fix login bug',
          blockName: 'task',
        });
        mentionKey = mention.getKey();
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode('Please '),
          mention,
          $createTextNode(' today')
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      editor.dispatchCommand(DO_SEARCH_COMMAND, 'login');
    });

    const offsets = getListOffset();
    expect(offsets.some((offset) => offset.key === mentionKey)).toBe(true);
    expect(offsets[0]?.offset.start).toBe(4);
    expect(offsets[0]?.offset.end).toBe(9);
  });

  it('still finds regular paragraph text next to a task chip', () => {
    const { editor, getListOffset } = createSearchEditor();
    let textKey = '';

    editor.update(
      () => {
        const mention = $createDocumentMentionNode({
          documentId: 'task-1',
          documentName: 'Fix login bug',
          blockName: 'task',
        });
        const text = $createTextNode('Please review today');
        textKey = text.getKey();
        const paragraph = $createParagraphNode();
        paragraph.append(text, mention);
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      editor.dispatchCommand(DO_SEARCH_COMMAND, 'review');
    });

    const offsets = getListOffset();
    expect(offsets.some((offset) => offset.key === textKey)).toBe(true);
    expect(offsets.every((offset) => offset.key === textKey)).toBe(true);
  });

  it('does not match ignored user-mention display names', () => {
    const { editor, getListOffset } = createSearchEditor();

    editor.update(
      () => {
        const mention = $createUserMentionNode({
          userId: 'user-1',
          email: 'wolf@macro.com',
          displayName: 'Wolf UniqueHandle',
        });
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('Hello '), mention);
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      editor.dispatchCommand(DO_SEARCH_COMMAND, 'UniqueHandle');
    });

    expect(getListOffset()).toEqual([]);
  });
});
