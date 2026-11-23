import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $isAccountManagerRequestNode } from '../nodes/AccountManagerRequestNode';
import { $isUnknownMentionNode } from '../nodes/UnknownMentionNode';
import { ALL_TRANSFORMERS } from '../transformers';
import { markdownToEmbeddingText, markdownToPlainText } from '../utils/parsers';

const GRANT_ID = '019a4f2e-7c1b-7d3a-9e2f-3b1c8d5a6f70';
const TAG = `<m-account-manager-request>{"id":"${GRANT_ID}"}</m-account-manager-request>`;

function editorWith(markdown: string) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
    },
    { discrete: true }
  );
  return editor;
}

function firstInlineNode(editor: ReturnType<typeof createEditor>) {
  return editor.getEditorState().read(() => {
    const [paragraph] = $getRoot().getChildren();
    if (!$isParagraphNode(paragraph)) throw new Error('expected a paragraph');
    return paragraph.getChildren()[0];
  });
}

describe('account manager request card', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    consoleError.mockRestore();
  });

  it('round-trips the tag through a node holding only the grant id', () => {
    const editor = editorWith(TAG);
    const node = firstInlineNode(editor);

    if (!$isAccountManagerRequestNode(node)) throw new Error('expected a card');
    expect(node.exportComponentProps()).toEqual({ grantId: GRANT_ID });
    expect(
      editor
        .getEditorState()
        .read(() => $convertToMarkdownString(ALL_TRANSFORMERS))
    ).toBe(TAG);
  });

  it('falls back to an unknown mention for a payload that is not a grant id', () => {
    const editor = editorWith(
      '<m-account-manager-request>{"id":"not-a-uuid"}</m-account-manager-request>'
    );

    expect($isUnknownMentionNode(firstInlineNode(editor))).toBe(true);
  });

  it('never leaks the payload into plain text or embeddings', () => {
    expect(markdownToPlainText(TAG)).toBe('Account manager request');
    expect(markdownToEmbeddingText(TAG)).toBe('Account manager request');
  });
});
