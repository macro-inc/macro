import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createPasteNode, $isPasteNode, PasteNode } from '../nodes/PasteNode';

// Internal Paste Node - uses XML-based format for serialization so the
// arbitrary pasted text survives a markdown round-trip without being parsed
// as markdown itself. Angle brackets in the content are escaped as unicode
// escapes so that XML tags inside the content don't get matched by other
// element transformers during import (JSON.parse handles </>).
export const I_PASTE_NODE: ElementTransformer = {
  dependencies: [PasteNode],
  type: 'element',
  regExp: /<m-paste>(.*?)<\/m-paste>/,
  export: (node) => {
    if (!$isPasteNode(node)) return null;
    const data = JSON.stringify({
      content: node.getContent(),
    })
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');
    return `<m-paste>${data}</m-paste>`;
  },
  replace: (
    parentNode: ElementNode,
    _children: Array<LexicalNode>,
    match: Array<string>
  ) => {
    try {
      const data = JSON.parse(match[1]);
      if (!('content' in data)) throw new Error('Missing field content');
      const pasteNode = $createPasteNode({ content: data.content });
      parentNode.replace(pasteNode);
    } catch (e) {
      console.error('Error in I_PASTE_NODE replace:', e);
    }
  },
};

// External Paste Node - exports the raw pasted text so external markdown
// consumers see the full content rather than an internal XML tag. Never
// imports (the regex never matches).
export const E_PASTE_NODE: ElementTransformer = {
  dependencies: [PasteNode],
  type: 'element',
  regExp: /$^/,
  export: (node) => {
    if (!$isPasteNode(node)) return null;
    return node.getContent();
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
