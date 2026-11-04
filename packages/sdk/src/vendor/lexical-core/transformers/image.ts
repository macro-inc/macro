// Vendored from packages/lexical-core/transformers/image.ts by `bun run vendor`; edit the source, not this copy.
import { $isListItemNode, $isListNode, ListItemNode } from '@lexical/list';
import type {
  ElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import {
  $findMatchingParent,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import { $createImageNode, $isImageNode, ImageNode } from '../nodes/ImageNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

// Internal transformer for images with constrained dimensions
export const I_IMAGE_CONSTRAINED: ElementTransformer = {
  dependencies: [ImageNode, UnknownMentionNode],
  type: 'element',
  regExp: /^\s*<m-image>(.*?)<\/m-image>\s*$/,
  export: (node: LexicalNode) => {
    if (!$isImageNode(node)) return null;
    if (node.getSrcType() === 'local') return null;
    if (!node.getUrl()) return null;

    const constrainedWidth = node.getConstrainedWidth();
    const constrainedHeight = node.getConstrainedHeight();
    if (constrainedWidth == null && constrainedHeight == null) {
      return null;
    }

    const data = JSON.stringify({
      url: node.getUrl(),
      alt: node.getAlt() || '',
      srcType: node.getSrcType(),
      id: node.getId(),
      width: node.getWidth(),
      height: node.getHeight(),
      scale: node.getScale(),
      constrainedWidth,
      constrainedHeight,
    });

    return `<m-image>${data}</m-image>`;
  },
  replace: (parent: ElementNode, _, match: string[], isImport: boolean) => {
    try {
      const data = JSON.parse(match[1] ?? '');
      if (!data.url) throw new Error('Missing url field');

      const imageNode = $createImageNode({
        srcType: data.srcType || 'url',
        url: data.url,
        alt: data.alt || '',
        id: data.id || '',
        width: data.width || 0,
        height: data.height || 0,
        scale: data.scale || 1,
        constrainedWidth: data.constrainedWidth ?? undefined,
        constrainedHeight: data.constrainedHeight ?? undefined,
      });
      if (isImport && $appendToPrecedingListItem(parent, imageNode, match)) {
        return;
      }
      parent.replace(imageNode);
    } catch (e) {
      console.error('Failed to parse m-image:', e);
      replaceElementWithUnknownMention(parent, 'Unknown Image');
    }
  },
};

// Standard markdown image transformer (for simple images without constraints)
export const IMAGE: ElementTransformer = {
  dependencies: [ImageNode],
  type: 'element',
  export: (node: LexicalNode) => {
    if (!$isImageNode(node)) return null;
    if (node.getSrcType() === 'local') return null;
    if (!node.getUrl()) return null;

    const altText = node.getAlt() || '';
    const url = node.getUrl();
    return `![${altText}](${url})`;
  },
  regExp: /!\[([^\]]*)\]\(([^)\s]+)(?:\s"([^"]*)"\s*)?\)$/,
  replace: (node, _, match, isImport) => {
    const [, altText, imageUrl] = match;
    const imageNode = $createImageNode({
      srcType: 'url',
      url: imageUrl,
      alt: altText || '',
      width: 0,
      height: 0,
      id: '',
    });
    if (isImport && $appendToPrecedingListItem(node, imageNode, match)) return;
    node.replace(imageNode);
  },
};

/**
 * An image line indented under a list belongs to the list item above it, as
 * {@link listItemImage} exports it. Moves the image into that item and drops
 * the line's paragraph, so the list stays one list.
 */
function $appendToPrecedingListItem(
  paragraph: ElementNode,
  image: ImageNode,
  match: string[]
): boolean {
  // Lexical passes the RegExp match, which keeps the whole line.
  if (!('input' in match) || typeof match.input !== 'string') return false;
  const line = match.input;
  const imageStart = line.length - line.trimStart().length;
  if (imageStart === 0 || imageStart !== line.indexOf(match[0].trimStart())) {
    return false;
  }
  const list = paragraph.getPreviousSibling();
  if (!$isListNode(list)) return false;
  const lastDescendant = list.getLastDescendant();
  const item = lastDescendant
    ? $findMatchingParent(lastDescendant, $isListItemNode)
    : list.getLastChild();
  if (!$isListItemNode(item)) return false;
  item.append(image);
  paragraph.remove();
  return true;
}

/**
 * Exports an image inside a list item on its own line, indented to the item's
 * text, so Markdown keeps it in the item and the list unbroken. Lexical runs
 * element transformers only on top-level nodes, so list children need a
 * text-match export.
 */
export function listItemImage(
  ...imageTransformers: ElementTransformer[]
): TextMatchTransformer {
  return {
    dependencies: [ImageNode, ListItemNode],
    type: 'text-match',
    regExp: /$^/,
    export: (node) => {
      if (!$isImageNode(node)) return null;
      const item = node.getParent();
      if (!$isListItemNode(item)) return null;
      for (const transformer of imageTransformers) {
        const markdown = transformer.export?.(node, () => '');
        if (markdown != null) {
          return `\n${' '.repeat(listItemTextIndent(item))}${markdown}`;
        }
      }
      return null;
    },
  };
}

// Lexical's list export indents each nesting level by this many spaces.
const LIST_INDENT_SIZE = 2;

/** Columns before a list item's text in Lexical's list export. */
function listItemTextIndent(item: ListItemNode): number {
  const list = item.getParent();
  if (!$isListNode(list)) return 0;
  let depth = 0;
  let ancestor = list.getParent();
  while ($isListItemNode(ancestor)) {
    depth++;
    ancestor = ancestor.getParent()?.getParent() ?? null;
  }
  const marker =
    list.getListType() === 'number' ? `${item.getValue()}. ` : '- ';
  return depth * LIST_INDENT_SIZE + marker.length;
}
