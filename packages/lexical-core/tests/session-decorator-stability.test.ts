// @vitest-environment jsdom
import { createHeadlessEditor } from '@lexical/headless';
import { $createParagraphNode, $getNodeByKey, $getRoot } from 'lexical';
import { afterEach, expect, it } from 'vitest';
import { clearDecorators, setDecorator } from '../decoratorRegistry';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $createAgentSessionMentionNode,
  AgentSessionMentionNode,
} from '../nodes/AgentSessionMentionNode';
import { $createMagicChipNode, MagicChipNode } from '../nodes/MagicChipNode';

afterEach(clearDecorators);

it.each(['mention', 'magic'] as const)(
  'keeps the %s decorator mounted across adjacent paragraph edits',
  (kind) => {
    setDecorator(AgentSessionMentionNode, () => null);
    setDecorator(MagicChipNode, () => null);
    const editor = createHeadlessEditor({
      nodes: [...SupportedNodeTypes, ...NodeReplacements],
    });
    let key = '';
    let original: unknown;
    editor.update(
      () => {
        const node =
          kind === 'mention'
            ? $createAgentSessionMentionNode({ id: 'session', expanded: true })
            : $createMagicChipNode({
                agentSessionId: 'session',
                promptedMessage: null,
                status: 'no_messages',
              });
        $getRoot().append(node);
        key = node.getKey();
        original = node.decorate(editor, editor._config);
      },
      { discrete: true }
    );
    for (const side of ['before', 'after'] as const) {
      editor.update(
        () => {
          const node = $getNodeByKey(key);
          if (
            !(
              node instanceof AgentSessionMentionNode ||
              node instanceof MagicChipNode
            )
          )
            throw new Error('Missing node');
          if (side === 'before') node.insertBefore($createParagraphNode());
          else node.insertAfter($createParagraphNode());
          expect(node.getLatest().decorate(editor, editor._config)).toBe(
            original
          );
        },
        { discrete: true }
      );
    }
    if (kind === 'mention') {
      editor.update(
        () => {
          const node = $getNodeByKey<AgentSessionMentionNode>(key)!;
          node.setLabel('Updated title');
          expect(node.getLatest().decorate(editor, editor._config)).not.toBe(
            original
          );
        },
        { discrete: true }
      );
    }
  }
);
