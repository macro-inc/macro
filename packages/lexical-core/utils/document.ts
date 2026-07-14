import { $unwrapMarkNode } from '@lexical/mark';
import { $dfsIterator, $unwrapNode } from '@lexical/utils';
import type { ElementNode } from 'lexical';
import { $isCommentNode } from '../nodes/CommentNode';
import { $isCompletionNode } from '../nodes/CompletionNode';
import { $isDiffNode } from '../nodes/DiffNode';
import { $isInlineSearchNode } from '../nodes/InlineSearchNode';
import { $isSearchMatchNode } from '../nodes/SearchMatchNode';

/**
 * Traverses a Lexical tree and sanitizes it by removing specific
 * document specific node types, such as CommentNodes, DiffNodes,
 * and ephemeral UI nodes like CompletionNodes, InlineSearchNodes,
 * and SearchMatchNodes.
 *
 * Nodes are handled in two ways:
 * - Remove entirely: CompletionNode, InlineSearchNode (temporary UI state)
 * - Unwrap: CommentNode, DiffNode, SearchMatchNode (preserve content, remove markup)
 *
 * @param rootNode The root ElementNode to start traversal from.
 */

export function $sanitizeLexicalTree(rootNode: ElementNode): void {
  for (const { node } of $dfsIterator(rootNode)) {
    // Remove entirely - these are temporary UI state with no meaningful content
    if ($isCompletionNode(node) || $isInlineSearchNode(node)) {
      node.remove();
    }
    // Unwrap - these wrap real content, keep the content but remove the markup
    else if ($isCommentNode(node) || $isSearchMatchNode(node)) {
      // CommentNode and SearchMatchNode extend MarkNode
      $unwrapMarkNode(node);
    } else if ($isDiffNode(node)) {
      // DiffNode extends ElementNode, so use $unwrapNode instead
      $unwrapNode(node);
    }
  }
}
