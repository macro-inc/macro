import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $isConnectAppNode, ConnectAppNode } from '../nodes/ConnectAppNode';
import { $isUnknownMentionNode } from '../nodes/UnknownMentionNode';
import { ALL_TRANSFORMERS, EXTERNAL_TRANSFORMERS } from '../transformers';
import { markdownToEmbeddingText, markdownToPlainText } from '../utils/parsers';

const TAG =
  '<m-connect-app>{"appSlug":"linear","name":"Linear"}</m-connect-app>';

function editorWith(markdown: string, transformers = ALL_TRANSFORMERS) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, transformers);
    },
    { discrete: true }
  );
  return editor;
}

function inlineNodes(editor: ReturnType<typeof createEditor>) {
  return editor.getEditorState().read(() => {
    const [paragraph] = $getRoot().getChildren();
    if (!$isParagraphNode(paragraph)) throw new Error('expected a paragraph');
    return paragraph.getChildren();
  });
}

describe('connect-app chip', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    consoleError.mockRestore();
  });

  it('parses the tag an agent copies out of a tool result', () => {
    const editor = editorWith(
      `Please connect it first: ${TAG} then ask again.`
    );
    const chip = inlineNodes(editor).find($isConnectAppNode);
    expect(chip).toBeInstanceOf(ConnectAppNode);
    expect(chip?.getAppSlug()).toBe('linear');
    expect(chip?.getName()).toBe('Linear');
  });

  it('renders inside the magic chip, which uses the external transformers', () => {
    const editor = editorWith(TAG, EXTERNAL_TRANSFORMERS);
    expect(inlineNodes(editor).some($isConnectAppNode)).toBe(true);
  });

  it('round-trips through markdown export', () => {
    const editor = editorWith(TAG);
    const exported = editor
      .getEditorState()
      .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
    expect(exported).toContain(TAG);
  });

  it('falls back to the unknown-mention chip for a slug the proxy would not route', () => {
    for (const payload of [
      '{"appSlug":"Linear App","name":"Linear"}',
      '{"appSlug":"../mcp-macro","name":"x"}',
      '{"appSlug":"linear"}',
      'not json',
    ]) {
      const editor = editorWith(`<m-connect-app>${payload}</m-connect-app>`);
      const nodes = inlineNodes(editor);
      expect(nodes.some($isConnectAppNode), payload).toBe(false);
      expect(nodes.some($isUnknownMentionNode), payload).toBe(true);
    }
  });

  it('reads as its call to action in plain and embedding text', () => {
    expect(markdownToPlainText(`Do this: ${TAG}`)).toBe(
      'Do this: Connect Linear'
    );
    expect(markdownToEmbeddingText(`Do this: ${TAG}`)).toBe(
      'Do this: Connect Linear'
    );
  });
});
