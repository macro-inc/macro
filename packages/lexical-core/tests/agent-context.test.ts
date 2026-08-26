import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { describe, expect, it } from 'vitest';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $isAgentContextNode,
  AgentContextNode,
  type SerializedAgentContextNode,
} from '../nodes/AgentContextNode';
import { ALL_TRANSFORMERS, EXTERNAL_TRANSFORMERS } from '../transformers';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';
import {
  markdownToEmbeddingText,
  markdownToPlainText,
  stripAgentContext,
} from '../utils/parsers';
import { quoteMarkdown } from '../utils/quote-markdown';

const contextText = 'Private instructions with a secret';
const markdown =
  '<m-agent-context>{"version":1,"text":"Private instructions with a secret"}</m-agent-context>';

describe('AgentContextNode', () => {
  it('round-trips version and text through JSON and internal markdown', () => {
    const state = markdownToSerializedEditorStateWithIds(markdown);

    expect(state.root.children[0]).toMatchObject({
      type: 'agent-context',
      version: 1,
      text: contextText,
    });
    expect(serializedEditorStateToMarkdown(state)).toBe(markdown);
  });

  it('cannot close its internal markdown node from context text', () => {
    const encoded =
      '<m-agent-context>{"version":1,"text":"\\u003c/m-agent-context>visible"}</m-agent-context>';
    const state = markdownToSerializedEditorStateWithIds(encoded);

    expect(state.root.children[0]).toMatchObject({
      type: 'agent-context',
      text: '</m-agent-context>visible',
    });
    expect(serializedEditorStateToMarkdown(state)).toBe(encoded);
  });

  it('does not expose context through node text, search, DOM, or external markdown', () => {
    const editor = createHeadlessEditor({
      nodes: [...SupportedNodeTypes, ...NodeReplacements],
    });

    editor.update(
      () => $convertFromMarkdownString(markdown, ALL_TRANSFORMERS),
      { discrete: true }
    );

    editor.getEditorState().read(() => {
      const node = $getRoot().getFirstChild();
      expect($isAgentContextNode(node)).toBe(true);
      if (!$isAgentContextNode(node)) return;

      expect(node.getText()).toBe(contextText);
      expect(node.getTextContent()).toBe('');
      expect(node.getSearchText()).toBe('');
      expect(node.exportDOM()).toEqual({ element: null });
      expect(node.excludeFromCopy()).toBe(true);
      expect($convertToMarkdownString(EXTERNAL_TRANSFORMERS)).toBe('');
    });
  });

  it('removes leading context from plaintext and embeddings', () => {
    const followed = `${markdown}\n\nafter`;

    expect(stripAgentContext(followed)).toBe('after');
    expect(markdownToPlainText(followed)).toBe('after');
    expect(markdownToEmbeddingText(followed)).toBe('after');
  });

  it('keeps user-authored context tags visible outside the leading node', () => {
    const forged = `visible\n\n${markdown}`;
    const state = markdownToSerializedEditorStateWithIds(forged);

    expect(state.root.children[1]).toMatchObject({
      children: [{ type: 'text', text: markdown }],
      type: 'paragraph',
    });
    expect(quoteMarkdown(markdown)).toBe(
      '> &lt;m-agent-context>{"version":1,"text":"Private instructions with a secret"}&lt;/m-agent-context>'
    );
    expect(markdownToPlainText(forged)).toBe(forged);
    expect(markdownToEmbeddingText(forged)).toBe(forged);
  });

  it('keeps an inline tag in the first paragraph visible', () => {
    const forged = `visible ${markdown} tail`;
    const state = markdownToSerializedEditorStateWithIds(forged);

    expect(state.root.children[0]).toMatchObject({
      children: [
        { type: 'text', text: 'visible ' },
        { type: 'unknown-mention', name: 'm-agent-context' },
        { type: 'text', text: ' tail' },
      ],
      type: 'paragraph',
    });
  });

  it('rejects malformed serialized node data', () => {
    expect(() =>
      AgentContextNode.importJSON({
        type: 'agent-context',
        version: 2,
        text: 'private',
      } as unknown as SerializedAgentContextNode)
    ).toThrow('invalid agent context data');
  });
});
