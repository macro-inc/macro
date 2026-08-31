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
  /** Markdown of the message that prompted the session, quoted back when `quote` is set. */
  promptMarkdown: string;
  /** The Magic Chip anchoring the session's live response. */
  chip: MagicChipData;
  /**
   * Whether to quote the prompt above the chip — the same rule as a human
   * channel reply: quote inside a thread, not on a top-level mention.
   */
  quote: boolean;
};

/**
 * Compose the channel message that announces an agent session.
 *
 * When `quote` is set, the prompting message is quoted back (exactly as a
 * human quote-reply would), followed by the session's Magic Chip. Top-level
 * replies skip that framing and emit only the chip. Built headlessly from
 * real Lexical nodes so the serialized markdown always matches what the
 * editor itself produces.
 */
export function composeAgentSessionAnnouncement(
  announcement: AgentSessionAnnouncement
): string {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      if (announcement.quote) {
        const quoted = quoteMarkdown(announcement.promptMarkdown);
        if (quoted) $convertFromMarkdownString(quoted, ALL_TRANSFORMERS);
      }
      $getRoot().append($createMagicChipNode(announcement.chip));
    },
    { discrete: true }
  );

  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}
