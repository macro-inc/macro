import { createHeadlessEditor } from '@lexical/headless';
import { $convertToMarkdownString } from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $createMagicChipNode,
  type MagicChipData,
} from '../nodes/MagicChipNode';
import {
  $createReplyTargetNode,
  stripLeadingReplyTargetMarkdown,
  type ReplyTargetData,
} from '../nodes/ReplyTargetNode';
import { ALL_TRANSFORMERS } from '../transformers';

/** Everything the announcement for one agent-session prompt is built from. */
export type AgentSessionAnnouncement = {
  /** Message the agent announcement explicitly replies to. */
  replyTarget: ReplyTargetData;
  /** The Magic Chip anchoring the session's live response. */
  chip: MagicChipData;
};

/**
 * Compose the channel message that announces an agent session: a structured
 * reply target followed by the session's Magic Chip. Built headlessly from
 * real Lexical nodes so the serialized markdown always matches what the
 * editor itself produces.
 */
export function composeAgentSessionAnnouncement(
  announcement: AgentSessionAnnouncement
): string {
  const replyTarget = {
    ...announcement.replyTarget,
    displayText: stripLeadingReplyTargetMarkdown(
      announcement.replyTarget.displayText
    )
      .trim()
      .replace(/\s+/g, ' '),
  };
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      if (replyTarget.displayText) {
        $getRoot().append($createReplyTargetNode(replyTarget));
      }
      $getRoot().append($createMagicChipNode(announcement.chip));
    },
    { discrete: true }
  );

  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}
