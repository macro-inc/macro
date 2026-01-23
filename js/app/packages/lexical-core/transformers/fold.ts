import type { ElementTransformer } from '@lexical/markdown';
import type { ElementNode, LexicalNode } from 'lexical';
import { $createFoldNode, $isFoldNode, FoldNode } from '../nodes/FoldNode';

// Internal Fold Node - uses XML-based format for serialization
export const I_FOLD_NODE: ElementTransformer = {
  dependencies: [FoldNode],
  type: 'element',
  regExp: /<m-fold>(.*?)<\/m-fold>/,
  export: (node) => {
    if (!$isFoldNode(node)) return null;

    const data = JSON.stringify({
      documentId: node.getDocumentId(),
      documentName: node.getDocumentName(),
      blockName: node.getBlockName(),
      content: node.getContent(),
      collapsed: node.getCollapsed(),
      mentionUuid: node.getMentionUuid(),
    });

    return `<m-fold>${data}</m-fold>`;
  },
  replace: (parent: ElementNode, _, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]);
      for (const field of [
        'documentId',
        'documentName',
        'blockName',
        'content',
      ]) {
        if (!(field in data)) throw new Error(`Missing field ${field}`);
      }

      const foldNode = $createFoldNode({
        documentId: data.documentId,
        documentName: data.documentName,
        blockName: data.blockName,
        content: data.content,
        collapsed: data.collapsed ?? true,
        mentionUuid: data.mentionUuid,
      });
      parent.append(foldNode);
    } catch (e) {
      console.error('Error in I_FOLD_NODE replace:', e);
    }
  },
};

// External Fold Node - exports to HTML <details> format for GFM compatibility
export const E_FOLD_NODE: ElementTransformer = {
  dependencies: [FoldNode],
  type: 'element',
  regExp: /$^/, // Never matches - no import from external format
  export: (node) => {
    if (!$isFoldNode(node)) return null;

    const documentName = node.getDocumentName();
    const content = node.getContent();

    if (!documentName || !content) {
      return null;
    }

    // Export as HTML <details> element (GFM compatible)
    return `<details>
<summary>\ud83d\udcc4 ${documentName}</summary>

${content}

</details>`;
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
