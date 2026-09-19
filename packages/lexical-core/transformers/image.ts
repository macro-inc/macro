import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createImageNode, $isImageNode, ImageNode } from '../nodes/ImageNode';
import {
  replaceElementWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

// Internal transformer for images with constrained dimensions
export const I_IMAGE_CONSTRAINED: ElementTransformer = {
  dependencies: [ImageNode, UnknownMentionNode],
  type: 'element',
  regExp: /^<m-image>(.*?)<\/m-image>\s*$/,
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
  replace: (parent: ElementNode, _, match: string[]) => {
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
      parent.append(imageNode);
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
  replace: (node, _, match) => {
    const [, altText, imageUrl] = match;
    const imageNode = $createImageNode({
      srcType: 'url',
      url: imageUrl,
      alt: altText || '',
      width: 0,
      height: 0,
      id: '',
    });
    node.replace(imageNode);
  },
};
