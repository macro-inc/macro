import type {
  ElementTransformer,
  TextMatchTransformer,
} from '@lexical/markdown';
import type { ElementNode, LexicalNode, TextNode } from 'lexical';
import {
  $createSnapshotNode,
  $isSnapshotNode,
  SnapshotNode,
} from '../nodes/SnapshotNode';

// Internal Snapshot Node - uses XML-based format for serialization
export const I_SNAPSHOT_NODE: TextMatchTransformer = {
  dependencies: [SnapshotNode],
  type: 'text-match',
  regExp: /<m-snapshot>(.*?)<\/m-snapshot>/,
  importRegExp: /<m-snapshot>(.*?)<\/m-snapshot>/,
  export: (node) => {
    if (!$isSnapshotNode(node)) return null;

    // Escape angle brackets as unicode escapes so that XML tags inside the
    // content (e.g. <m-document-card>) don't get matched by element
    // transformers during import. JSON.parse handles \u003c/\u003e natively.
    const data = JSON.stringify({
      documentId: node.getDocumentId(),
      documentName: node.getDocumentName(),
      blockName: node.getBlockName(),
      content: node.getContent(),
      snapshotDate: node.getSnapshotDate(),
      mentionUuid: node.getMentionUuid(),
    })
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');

    return `<m-snapshot>${data}</m-snapshot>`;
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

      const snapshotNode = $createSnapshotNode({
        documentId: data.documentId,
        documentName: data.documentName,
        blockName: data.blockName,
        content: data.content,
        snapshotDate: data.snapshotDate || new Date().toISOString(),
        mentionUuid: data.mentionUuid,
      });
      node.replace(snapshotNode);
    } catch (e) {
      console.error('Error in I_SNAPSHOT_NODE replace:', e);
    }
  },
};

// External Snapshot Node - exports to document link format
export const E_SNAPSHOT_NODE: ElementTransformer = {
  dependencies: [SnapshotNode],
  type: 'element',
  regExp: /$^/, // Never matches - no import from external format
  export: (node) => {
    if (!$isSnapshotNode(node)) return null;

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
