import { parseInternalAppLink } from '@core/util/macroAppUrl';
import { $isAutoLinkNode, $isLinkNode } from '@lexical/link';
import { $dfs } from '@lexical/utils';
import type { EditorState } from 'lexical';

const MAX_LINK_PREVIEWS = 3;

function isPreviewableUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;

  // A Macro item renders as a mention; its public page would only say "Macro".
  return parseInternalAppLink(url) === null;
}

/**
 * The web links in a rendered message that get a preview card: in order of
 * first appearance, without repeats, and at most three. Links the author
 * removed, email addresses, and links into the Macro app get none.
 */
export function getLinkPreviewUrls(state: EditorState): string[] {
  const urls = new Set<string>();

  state.read(() => {
    for (const { node } of $dfs()) {
      if (urls.size === MAX_LINK_PREVIEWS) return;
      if (!$isLinkNode(node)) continue;
      if ($isAutoLinkNode(node) && node.getIsUnlinked()) continue;

      const url = node.getURL();
      if (isPreviewableUrl(url)) urls.add(url);
    }
  });

  return [...urls];
}
