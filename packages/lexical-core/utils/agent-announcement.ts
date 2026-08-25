import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $createMagicChipNode,
  type MagicChipData,
} from '../nodes/MagicChipNode';
import { ALL_TRANSFORMERS } from '../transformers';
import { quoteMarkdown } from './quote-markdown';

/** Everything the announcement for one agent-session prompt is built from. */
export type AgentSessionAnnouncement = {
  /** Markdown of the message that prompted the session, quoted back. */
  promptMarkdown: string;
  /** The Magic Chip anchoring the session's live response. */
  chip: MagicChipData;
};

/**
 * Compose the channel message that announces an agent session: the prompting
 * message quoted back (exactly as quote-reply would), followed by the
 * session's Magic Chip. Built headlessly from real Lexical nodes so the
 * serialized markdown always matches what the editor itself produces.
 */
export function composeAgentSessionAnnouncement(
  announcement: AgentSessionAnnouncement
): string {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      const quote = quoteMarkdown(announcement.promptMarkdown);
      if (quote) $convertFromMarkdownString(quote, ALL_TRANSFORMERS);
      $getRoot().append($createMagicChipNode(announcement.chip));
    },
    { discrete: true }
  );

  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}
