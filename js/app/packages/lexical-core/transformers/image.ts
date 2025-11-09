import type { ElementTransformer } from '@lexical/markdown';
import type { LexicalNode } from 'lexical';
import { $createImageNode, $isImageNode, ImageNode } from '../nodes/ImageNode';

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
