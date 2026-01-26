import type {
  ElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import type { ElementNode, LexicalNode, TextNode } from 'lexical';
import { $createFoldNode, $isFoldNode, FoldNode } from '../nodes/FoldNode';

// Internal Fold Node - uses XML-based format for serialization
export const I_FOLD_NODE: TextMatchTransformer = {
  dependencies: [FoldNode],
  type: 'text-match',
  regExp: /<m-fold>(.*?)<\/m-fold>/,
  importRegExp: /<m-fold>(.*?)<\/m-fold>/,
  export: (node) => {
    if (!$isFoldNode(node)) return null;

    const data = JSON.stringify({
      documentId: node.getDocumentId(),
      documentName: node.getDocumentName(),
      blockName: node.getBlockName(),
      content: node.getContent(),
      snapshotDate: node.getSnapshotDate(),
      mentionUuid: node.getMentionUuid(),
    });

    return `<m-fold>${data}</m-fold>`;
  },
  replace: (node: TextNode, match: RegExpMatchArray) => {
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
        snapshotDate: data.snapshotDate || new Date().toISOString(),
        mentionUuid: data.mentionUuid,
      });
      node.replace(foldNode);
    } catch (e) {
      console.error('Error in I_FOLD_NODE replace:', e);
    }
  },
};

// External Fold Node - exports to document link format
export const E_FOLD_NODE: ElementTransformer = {
  dependencies: [FoldNode],
  type: 'element',
  regExp: /$^/, // Never matches - no import from external format
  export: (node) => {
    if (!$isFoldNode(node)) return null;

    const documentName = node.getDocumentName();
    const documentId = node.getDocumentId();
    const blockName = node.getBlockName();

    if (!documentName || !documentId || !blockName) {
      return null;
    }

    // Export as a document link similar to DocumentMention
    const hostname =
      window.location.hostname === 'localhost'
        ? 'dev.macro.com'
        : window.location.hostname.replace('www.', '').toLowerCase();
    const documentUrl = `https://${hostname}/app/${blockName}/${documentId}`;
    return `[${documentName}](${documentUrl})`;
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
