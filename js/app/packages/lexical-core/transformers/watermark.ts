import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import {
  $createWatermarkNode,
  $isWatermarkNode,
  WatermarkNode,
} from '../nodes/WatermarkNode';

// Internal Watermark
export const I_WATERMARK: ElementTransformer = {
  dependencies: [WatermarkNode],
  type: 'element',
  regExp: /<m-watermark>(.*?)<\/m-watermark>/,
  export: (node) => {
    if (!$isWatermarkNode(node)) return null;

    const data = JSON.stringify({
      content: node.getContent(),
    });

    return `<m-watermark>${data}</m-watermark>`;
  },
  replace: (parent: ElementNode, _, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      for (const field of ['content']) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }

      const watermarkNode = $createWatermarkNode({ content: data.content });
      parent.append(watermarkNode);
    } catch (e) {
      console.error(e);
    }
  },
};

// External Watermarks
export const E_WATERMARK: ElementTransformer = {
  dependencies: [WatermarkNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!$isWatermarkNode(node)) return null;

    const content = node.getContent();

    if (!content) {
      return null;
    }

    // For external representation, just show the content
    return content;
  },
  replace: (
    _parentNode: ElementNode,
    _children: Array<LexicalNode>,
    _match: Array<string>,
    _isImport: boolean
  ) => {
    return false;
  },
};
