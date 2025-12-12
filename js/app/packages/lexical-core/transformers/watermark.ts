import type {
  ElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import type { ElementNode, LexicalNode, TextNode } from 'lexical';
import { WatermarkNode } from '../nodes/WatermarkNode';

// Internal Watermark
export const I_WATERMARK: TextMatchTransformer = {
  dependencies: [WatermarkNode],
  type: 'text-match',
  regExp: /<m-watermark>(.*?)<\/m-watermark>/,
  importRegExp: /<m-watermark>(.*?)<\/m-watermark>/,
  export: (node) => {
    if (!(node instanceof WatermarkNode)) return null;
    const data = JSON.stringify({
      content: node.getContent(),
    });
    return `<m-watermark>${data}</m-watermark>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      console.log('Replace', node, match);
      const data = JSON.parse(match[1]);
      for (const field of ['content']) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }

      const watermarkNode = new WatermarkNode(data.content);
      node.replace(watermarkNode);
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
    console.log('External', node);
    if (!(node instanceof WatermarkNode)) return null;

    const content = node.getContent();
    if (!content) {
      return null;
    }

    // For external representation, just show the display format
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
