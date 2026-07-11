import type { TextMatchTransformer } from '@lexical/markdown';
import type { TextNode } from 'lexical';
import {
  $createHtmlRenderNode,
  $isHtmlRenderNode,
  HtmlRenderNode,
} from '../nodes/HtmlRenderNode';
import {
  replaceTextWithUnknownMention,
  UnknownMentionNode,
} from './unknownFallback';

// Internal transformer — carries the raw HTML payload so rendered email
// content (e.g. a forwarded message with tables) survives the markdown
// round-trip. Text-match rather than element: element transformers only run
// on top-level nodes, and this node lives nested inside blockquotes, where
// only text-match transformers are consulted.
export const I_HTML_RENDER: TextMatchTransformer = {
  dependencies: [HtmlRenderNode, UnknownMentionNode],
  type: 'text-match',
  regExp: /<m-html-render>(.*?)<\/m-html-render>/,
  importRegExp: /<m-html-render>(.*?)<\/m-html-render>/,
  export: (node) => {
    if (!$isHtmlRenderNode(node)) return null;

    // Escape angle brackets as unicode escapes so tags inside the HTML don't
    // get matched by other transformers during import. JSON.parse handles
    // them natively.
    const data = JSON.stringify(node.exportComponentProps())
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');

    return `<m-html-render>${data}</m-html-render>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1] ?? '');
      if (typeof data.html !== 'string') {
        throw new Error('Missing html field');
      }
      node.replace($createHtmlRenderNode({ html: data.html }));
    } catch (e) {
      console.error('Failed to parse m-html-render:', e);
      replaceTextWithUnknownMention(node, 'Unknown Content');
    }
  },
};
