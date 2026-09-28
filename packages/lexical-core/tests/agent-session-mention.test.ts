// @vitest-environment jsdom
import { createHeadlessEditor } from '@lexical/headless';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isParagraphNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $createAgentSessionMentionNode,
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
  it('preserves expansion and session-reference semantics through Markdown', () => {
    const expanded = buildAgentSessionMentionMarkdown({
      ...info,
      expanded: true,
    });
    const state = markdownToSerializedEditorStateWithIds(expanded);
    expect(state.root.children[0]).toMatchObject({
      type: 'agent-session-mention',
      expanded: true,
    });
    expect(serializedEditorStateToMarkdown(state)).toBe(expanded);
    expect(extractChannelMentionsFromMarkdown(expanded)).toEqual([
      { entityType: 'agent_session', entityId: info.id },
    ]);
    expect(markdownToPlainText(expanded)).toBe(info.label);
    expect(markdownToEmbeddingText(expanded)).toBe(
      '[Fix the menu](agent_session:session-1)'
    );
  });

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

  it.each([false, true])(
    'preserves identity and expansion through HTML (expanded: %s)',
    (expanded) => {
      const editor = createHeadlessEditor({
        nodes: [...SupportedNodeTypes, ...NodeReplacements],
      });
      editor.setEditorState(
        editor.parseEditorState(
          markdownToSerializedEditorStateWithIds(
            buildAgentSessionMentionMarkdown({
              ...info,
              ...(expanded ? { expanded: true } : {}),
            })
          )
        )
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
          const node = $isParagraphNode(paragraph)
            ? paragraph.getFirstChild()
            : paragraph;
          expect($isAgentSessionMentionNode(node)).toBe(true);
          if ($isAgentSessionMentionNode(node)) {
            expect(node.getId()).toBe(info.id);
            expect(node.isExpanded()).toBe(expanded);
          }
        },
        { discrete: true }
      );
    }
  );
});

it('expands between text into a block and collapses back into an inline paragraph', () => {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
  let key = '';
  editor.update(
    () => {
      const node = $createAgentSessionMentionNode(info);
      key = node.getKey();
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode('Before'),
          node,
          $createTextNode('After')
        )
      );
      node.setExpanded(true);
    },
    { discrete: true }
  );
  editor.getEditorState().read(() => {
    const nodes = $getRoot().getChildren();
    expect(nodes.map((node) => node.getType())).toEqual([
      'paragraph',
      'agent-session-mention',
      'paragraph',
    ]);
    expect(nodes.map((node) => node.getTextContent())).toEqual([
      'Before',
      info.label,
      'After',
    ]);
    expect($getNodeByKey(key)?.isInline()).toBe(false);
  });
  editor.update(
    () => {
      const node = $getNodeByKey(key);
      if ($isAgentSessionMentionNode(node)) node.setExpanded(false);
    },
    { discrete: true }
  );
  editor.getEditorState().read(() => {
    const node = $getNodeByKey(key);
    expect(node?.isInline()).toBe(true);
    expect($isParagraphNode(node?.getParent())).toBe(true);
    expect($getRoot().getTextContent()).toContain('Before');
    expect($getRoot().getTextContent()).toContain('After');
  });
});
