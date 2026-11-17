import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { ALL_TRANSFORMERS } from '../transformers';
import { $convertMacroAppLinksToMentions } from './app-link-mentions';
import { $extractChannelMentions, type ChannelMention } from './mentions';

/**
 * Parses a macro markdown string headlessly and extracts its mentions as
 * `ChannelMention`s — the server-side equivalent of the mention tracking the
 * web editor does while composing a channel message.
 *
 * With `appOrigin`, links to Macro entities on that web app count as mentions
 * too, as they do once a document is created from the same markdown. Channel
 * messages leave it out: a message reference shares its target with the
 * channel.
 */
export function extractChannelMentionsFromMarkdown(
  markdown: string,
  { appOrigin }: { appOrigin?: string } = {}
): ChannelMention[] {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
      if (appOrigin) $convertMacroAppLinksToMentions(appOrigin);
    },
    { discrete: true }
  );

  return editor.getEditorState().read(() => $extractChannelMentions());
}
