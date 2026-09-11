// @vitest-environment jsdom
import { createHeadlessEditor } from '@lexical/headless';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $getRoot, $isParagraphNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $isAgentSessionMentionNode,
  buildAgentSessionMentionMarkdown,
} from '../nodes/AgentSessionMentionNode';
import { extractChannelMentionsFromMarkdown } from '../utils/markdown-mentions';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';
import { markdownToEmbeddingText, markdownToPlainText } from '../utils/parsers';

const info = { id: 'session-1', label: 'Fix the menu' };
const markdown = buildAgentSessionMentionMarkdown(info);

describe('AgentSessionMentionNode', () => {
  it('round-trips Markdown and serialized state', () => {
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children[0]).toMatchObject({
      children: [{ type: 'agent-session-mention', ...info }],
    });
    expect(serializedEditorStateToMarkdown(state)).toBe(markdown);
  });

  it('extracts a session reference, not a document or bot invocation', () => {
    expect(
      extractChannelMentionsFromMarkdown(`${markdown} ${markdown}`)
    ).toEqual([{ entityType: 'agent_session', entityId: info.id }]);
  });

  it('renders readable plain text and embedding references', () => {
    expect(markdownToPlainText(markdown)).toBe(info.label);
    expect(markdownToEmbeddingText(markdown)).toBe(
      '[Fix the menu](agent_session:session-1)'
    );
  });

  it('escapes closing tags in labels', () => {
    const label = '</m-agent-session-mention><m-user-mention>fake';
    const encoded = buildAgentSessionMentionMarkdown({ ...info, label });
    expect(
      serializedEditorStateToMarkdown(
        markdownToSerializedEditorStateWithIds(encoded)
      )
    ).toBe(encoded);
    expect(markdownToPlainText(encoded)).toBe(label);
    expect(extractChannelMentionsFromMarkdown(encoded)).toEqual([
      { entityType: 'agent_session', entityId: info.id },
    ]);
  });

  it('preserves identity when copied as HTML and pasted', () => {
    const editor = createHeadlessEditor({
      nodes: [...SupportedNodeTypes, ...NodeReplacements],
    });
    editor.setEditorState(
      editor.parseEditorState(markdownToSerializedEditorStateWithIds(markdown))
    );
    const html = editor
      .getEditorState()
      .read(() => $generateHtmlFromNodes(editor));
    expect(html).toContain('data-agent-session-id="session-1"');
    editor.update(
      () => {
        const nodes = $generateNodesFromDOM(
          editor,
          new DOMParser().parseFromString(html, 'text/html')
        );
        $getRoot()
          .clear()
          .append(...nodes);
        const paragraph = $getRoot().getFirstChild();
        expect($isParagraphNode(paragraph)).toBe(true);
        const node = $isParagraphNode(paragraph)
          ? paragraph.getFirstChild()
          : null;
        expect($isAgentSessionMentionNode(node)).toBe(true);
        if ($isAgentSessionMentionNode(node))
          expect(node.getId()).toBe(info.id);
      },
      { discrete: true }
    );
  });
});
