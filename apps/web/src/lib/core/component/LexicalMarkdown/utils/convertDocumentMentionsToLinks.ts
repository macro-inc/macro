import type { DocumentMentionInfo } from '@macro-inc/lexical-core';

/** Replace Macro document-mention elements with portable HTML links. */
export function convertDocumentMentionsToLinks(
  root: ParentNode
): DocumentMentionInfo[] {
  const mentionElements = root.querySelectorAll<HTMLElement>(
    '[data-document-mention="true"]'
  );
  const mentions: DocumentMentionInfo[] = [];

  mentionElements.forEach((element) => {
    const collapsed = element.getAttribute('data-collapsed');
    const mention: DocumentMentionInfo = {
      documentId: element.getAttribute('data-document-id') || '',
      documentName: element.getAttribute('data-document-name') || '',
      blockName: element.getAttribute('data-block-name') || '',
      blockParams: element.getAttribute('data-block-params')
        ? JSON.parse(element.getAttribute('data-block-params') || '{}')
        : undefined,
      mentionUuid: element.getAttribute('data-mention-uuid') || undefined,
      collapsed: collapsed === null ? undefined : collapsed === 'true',
      channelType: element.getAttribute('data-channel-type') || undefined,
    };
    if (!mention.documentId || !mention.documentName || !mention.blockName) {
      return;
    }

    const link = document.createElement('a');
    link.href = `${window.location.origin}/app/${mention.blockName}/${mention.documentId}`;
    link.textContent = mention.documentName;

    // Preserve mention data attributes so importing this HTML into Macro can
    // recreate the richer Lexical node.
    link.setAttribute('data-document-mention', 'true');
    link.setAttribute('data-document-id', mention.documentId);
    link.setAttribute('data-document-name', mention.documentName);
    link.setAttribute('data-block-name', mention.blockName);
    if (mention.blockParams) {
      link.setAttribute(
        'data-block-params',
        JSON.stringify(mention.blockParams)
      );
    }
    if (mention.mentionUuid) {
      link.setAttribute('data-mention-uuid', mention.mentionUuid);
    }
    if (mention.collapsed !== undefined) {
      link.setAttribute('data-collapsed', String(mention.collapsed));
    }
    if (mention.channelType) {
      link.setAttribute('data-channel-type', mention.channelType);
    }

    element.replaceWith(link);
    mentions.push(mention);
  });

  return mentions;
}
