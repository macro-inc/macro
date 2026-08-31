import {
  $createDateMentionNode,
  $createDocumentMentionNode,
  $createEquationNode,
  $createHorizontalRuleNode,
  $createTagMentionNode,
  $createUserMentionNode,
} from '@macro-inc/lexical-core';
import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import { $collectFindMatches, countFindMatches } from './findAndReplacePlugin';

function createTestEditor(): LexicalEditor {
  return createEditor({
    namespace: 'find-and-replace-plugin-test',
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
}

function collectMatches(editor: LexicalEditor, query: string) {
  return editor.getEditorState().read(() => $collectFindMatches(query));
}

describe('$collectFindMatches', () => {
  test('finds plain text matches', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('please review the login bug'));
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    const matches = collectMatches(editor, 'login');
    expect(countFindMatches(matches)).toBe(1);
    expect(matches[0]?.highlightEntire).toBeFalsy();
  });

  test('finds the term inside a task chip', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode('See '),
          $createDocumentMentionNode({
            documentId: 'task-1',
            documentName: 'Fix the login bug',
            blockName: 'task',
          }),
          $createTextNode(' later')
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    const matches = collectMatches(editor, 'login');
    expect(countFindMatches(matches)).toBe(1);
    expect(matches[0]?.highlightEntire).toBe(true);
    editor.read(() => {
      const node = $getNodeByKey(matches[0]!.key);
      expect(node?.getType()).toBe('document-mention');
      expect(node?.getTextContent()).toBe('Fix the login bug');
    });
  });

  test('finds the term inside other mention chips', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createUserMentionNode({
            userId: 'user-1',
            email: 'ada@example.com',
            displayName: 'Ada Lovelace',
          }),
          $createTextNode(' reviewed '),
          $createDateMentionNode({
            date: '2024-03-15',
            displayFormat: 'March 15',
          }),
          $createTextNode(' '),
          $createTagMentionNode({
            optionId: 'tag-1',
            propertyDefinitionId: 'prop-1',
            scope: 'team',
            name: 'urgent-login',
          })
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true }
    );

    expect(countFindMatches(collectMatches(editor, 'Ada'))).toBe(1);
    expect(countFindMatches(collectMatches(editor, 'March'))).toBe(1);
    expect(countFindMatches(collectMatches(editor, 'login'))).toBe(1);
    expect(
      collectMatches(editor, 'Ada')[0]?.highlightEntire &&
        collectMatches(editor, 'March')[0]?.highlightEntire &&
        collectMatches(editor, 'login')[0]?.highlightEntire
    ).toBe(true);
  });

  test('does not match ignored equation or horizontal-rule nodes', () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode('plain '),
          $createEquationNode('login^2', true)
        );
        $getRoot().clear().append(paragraph, $createHorizontalRuleNode());
      },
      { discrete: true }
    );

    expect(collectMatches(editor, 'login')).toEqual([]);
  });
});
