const DOCUMENT_MENTION_PATTERN =
  /<m-document-mention>([\s\S]*?)<\/m-document-mention>/g;

export type DocumentMentionRef = {
  documentId: string;
  blockName?: string;
};

/**
 * The items referenced by `<m-document-mention>` tags in Macro markdown, in
 * order of first appearance and without repeats. Malformed tags render as
 * unknown items rather than references, so they are skipped.
 */
export function getDocumentMentions(content: string): DocumentMentionRef[] {
  const mentions = new Map<string, DocumentMentionRef>();

  for (const match of content.matchAll(DOCUMENT_MENTION_PATTERN)) {
    try {
      const mention = JSON.parse(match[1]);
      if (
        mention &&
        typeof mention === 'object' &&
        typeof mention.documentId === 'string' &&
        'documentName' in mention &&
        !mentions.has(mention.documentId)
      ) {
        mentions.set(mention.documentId, {
          documentId: mention.documentId,
          blockName:
            typeof mention.blockName === 'string'
              ? mention.blockName
              : undefined,
        });
      }
    } catch {
      // Malformed mention markup renders as an unknown item, not a reference.
    }
  }

  return [...mentions.values()];
}

/** IDs of the items referenced by `<m-document-mention>` tags in `content`. */
export function getMentionedItemIds(content: string): Set<string> {
  return new Set(
    getDocumentMentions(content).map((mention) => mention.documentId)
  );
}
