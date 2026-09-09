/**
 * @vitest-environment jsdom
 */

import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import {
  $collapseInlineSearch,
  $createInlineSearchNode,
  $isInlineSearchNode,
  $removeInlineSearch,
  InlineSearchNodesType,
} from '@macro-inc/lexical-core/nodes/InlineSearchNode';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'inline-search-test',
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  return editor;
}

function seedMentionAndCommandSearches(editor: LexicalEditor) {
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append(
        $createInlineSearchNode('@docs'),
        $createTextNode(' '),
        $createInlineSearchNode('/qc')
      );
      $getRoot().clear().append(paragraph);
    },
    { discrete: true }
  );
}

describe('$collapseInlineSearch', () => {
  it('leaves @ mention search intact when collapsing slash commands', () => {
    const editor = createTestEditor();
    seedMentionAndCommandSearches(editor);

    editor.update(
      () => {
        $collapseInlineSearch(undefined, InlineSearchNodesType.Actions);
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getRoot().getFirstChild()?.getChildren() ?? [];
      expect($isInlineSearchNode(children[0])).toBe(true);
      expect(children[0]?.getTextContent()).toBe('@docs');
      expect(
        $isTextNode(children[2]) && !$isInlineSearchNode(children[2])
      ).toBe(true);
      expect(children[2]?.getTextContent()).toBe('/qc');
    });
  });

  it('collapses every inline search when no type is given', () => {
    const editor = createTestEditor();
    seedMentionAndCommandSearches(editor);

    editor.update(
      () => {
        $collapseInlineSearch();
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getRoot().getFirstChild()?.getChildren() ?? [];
      expect(children.every((node) => $isTextNode(node))).toBe(true);
      expect(children.some((node) => $isInlineSearchNode(node))).toBe(false);
    });
  });
});

describe('$removeInlineSearch', () => {
  it('removes only the matching trigger', () => {
    const editor = createTestEditor();
    seedMentionAndCommandSearches(editor);

    editor.update(
      () => {
        $removeInlineSearch(undefined, InlineSearchNodesType.Mentions);
      },
      { discrete: true }
    );

    editor.read(() => {
      const children = $getRoot().getFirstChild()?.getChildren() ?? [];
      const searches = children.filter($isInlineSearchNode);
      expect(searches).toHaveLength(1);
      expect(searches[0]?.getTextContent()).toBe('/qc');
    });
  });
});
