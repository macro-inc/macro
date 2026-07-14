import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { ALL_TRANSFORMERS } from '../transformers';
import { $extractChannelMentions, type ChannelMention } from './mentions';

/**
 * Parses a macro markdown string headlessly and extracts its mentions as
 * `ChannelMention`s — the server-side equivalent of the mention tracking the
 * web editor does while composing a channel message.
 */
export function extractChannelMentionsFromMarkdown(
  markdown: string
): ChannelMention[] {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
    },
    { discrete: true }
  );

  return editor.getEditorState().read(() => $extractChannelMentions());
}
