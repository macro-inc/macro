// Vendored from packages/lexical-core/transformers/unknownFallback.ts by `bun run vendor`; edit the source, not this copy.
import { $createParagraphNode, type ElementNode, type TextNode } from 'lexical';
import {
  $createUnknownMentionNode,
  UnknownMentionNode,
} from '../nodes/UnknownMentionNode';

export { UnknownMentionNode };

export function replaceTextWithUnknownMention(
  node: TextNode,
  name: string
): void {
  node.replace($createUnknownMentionNode({ name }));
}

export function replaceElementWithUnknownMention(
  node: ElementNode,
  name: string
): void {
  const paragraph = $createParagraphNode();
  paragraph.append($createUnknownMentionNode({ name }));
  node.replace(paragraph);
}
