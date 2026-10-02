import { $createLinkNode, $isLinkNode } from '@lexical/link';
import { $getRoot } from 'lexical';
import { findNextAutoLinkMatch } from '../../plugins/links/linksPlugin';

/** Link protocol URLs in prose, preserving existing links and code literals. */
export function $linkifyStaticText() {
  for (const text of $getRoot().getAllTextNodes()) {
    if (text.hasFormat('code') || text.getParent()?.getType() === 'code')
      continue;
    let parent = text.getParent();
    let linked = false;
    while (parent) {
      if ($isLinkNode(parent)) {
        linked = true;
        break;
      }
      parent = parent.getParent();
    }
    if (linked) continue;
    let remaining = text;
    while (remaining) {
      const match = findNextAutoLinkMatch(remaining.getTextContent());
      if (!match) break;
      const pieces = remaining.splitText(match.index, match.lastIndex);
      const matched = pieces[match.index === 0 ? 0 : 1];
      const after = pieces[match.index === 0 ? 1 : 2];
      const link = $createLinkNode(match.url);
      matched.replace(link);
      link.append(matched);
      remaining = after;
    }
  }
}
