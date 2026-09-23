import { $createListItemNode, $createListNode } from '@lexical/list';
import {
  $createDocumentMentionNode,
  $createUserMentionNode,
} from '@macro-inc/lexical-core';
import {
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core/node-list';
import { markdownToSerializedEditorStateWithIds } from '@macro-inc/lexical-core/utils/markdown-state';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
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
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
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

function searchMarkdown(markdown: string, query: string) {
  const { editor, getListOffset } = createSearchEditor();
  editor.setEditorState(
    editor.parseEditorState(markdownToSerializedEditorStateWithIds(markdown))
  );
  return editor.getEditorState().read(() => {
    editor.dispatchCommand(DO_SEARCH_COMMAND, query);
    return getListOffset().map((item) => ({
      text: $getNodeByKey(item.key)
        ?.getTextContent()
        .slice(item.offset.start, item.offset.end),
      isReplace: item.offset.isReplace,
      pairKey: item.pairKey,
    }));
  });
}

describe('findAndReplacePlugin multi-line blocks', () => {
  const markdown = [
    'Intro paragraph.',
    '',
    '```graphql',
    'type Calendar { id: ID!',
    '',
    '  isPrimary: Boolean! }',
    '```',
    '',
    '- **Fan-out:** a change is logged for every user.',
  ].join('\n');

  it('finds text inside a code block', () => {
    expect(searchMarkdown(markdown, 'isprimary')).toEqual([
      { text: 'isPrimary', isReplace: true, pairKey: 1 },
    ]);
  });

  it('finds text after a code block', () => {
    expect(searchMarkdown(markdown, 'fan-out')).toEqual([
      { text: 'Fan-out', isReplace: true, pairKey: 1 },
    ]);
    expect(searchMarkdown(markdown, 'every user')).toEqual([
      { text: 'every user', isReplace: true, pairKey: 1 },
    ]);
  });

  it('numbers every match in document order', () => {
    const matches = searchMarkdown(markdown, 'i');
    expect(matches.map((match) => match.text)).toEqual(
      matches.map(() => expect.stringMatching(/^i$/i))
    );
    expect(matches.map((match) => match.pairKey)).toEqual(
      matches.map((_, index) => index + 1)
    );
    expect(matches).toHaveLength(6);
  });

  it('splits a match across formatted text nodes', () => {
    expect(searchMarkdown('Say **hel**lo there', 'hello')).toEqual([
      { text: 'hel', isReplace: true, pairKey: 1 },
      { text: 'lo', isReplace: false, pairKey: 1 },
    ]);
  });

  it('does not match across block boundaries', () => {
    expect(searchMarkdown('first\n\nsecond', 'firstsecond')).toEqual([]);
  });
});

describe('findAndReplacePlugin nested blocks', () => {
  it('separates inline text from a block nested after it', () => {
    const { editor, getListOffset } = createSearchEditor();

    editor.update(
      () => {
        const parent = $createListItemNode();
        parent.append(
          $createTextNode('parent'),
          $createListNode('bullet').append(
            $createListItemNode().append($createTextNode('child'))
          )
        );
        $getRoot().clear().append($createListNode('bullet').append(parent));
      },
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      editor.dispatchCommand(DO_SEARCH_COMMAND, 'parentchild');
    });
    expect(getListOffset()).toEqual([]);

    editor.getEditorState().read(() => {
      editor.dispatchCommand(DO_SEARCH_COMMAND, 'child');
    });
    expect(getListOffset()).toHaveLength(1);
  });
});
