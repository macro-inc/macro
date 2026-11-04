import { $dfsIterator } from '@lexical/utils';
import { $isInlineSearchNode } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';

/**
 * Whether Escape should close something inside a composer rather than the
 * composer itself: a recipient field's suggestions, or the body's @-mention,
 * emoji or snippet search (each is an inline search node while it is open).
 */
export function fieldOwnsEscape(body: LexicalEditor | undefined) {
  if (document.activeElement?.getAttribute('aria-expanded') === 'true')
    return true;
  return (
    body
      ?.getEditorState()
      .read(() =>
        [...$dfsIterator()].some(({ node }) => $isInlineSearchNode(node))
      ) ?? false
  );
}
