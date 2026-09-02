import { convertDocumentMentionsToLinks } from '@core/component/LexicalMarkdown/utils/convertDocumentMentionsToLinks';

const DOCUMENT_MENTION_PATTERN =
  /<m-document-mention>(.*?)<\/m-document-mention>/g;

/** Convert internal mention markup to links understood by calendar providers. */
export function prepareCalendarDescription(markdown: string): string {
  return markdown.replace(
    DOCUMENT_MENTION_PATTERN,
    (serializedMention, serializedInfo: string) => {
      try {
        const info = JSON.parse(serializedInfo) as Record<string, unknown>;
        if (
          typeof info.documentId !== 'string' ||
          typeof info.documentName !== 'string' ||
          typeof info.blockName !== 'string'
        ) {
          return serializedMention;
        }

        const container = document.createElement('div');
        const mention = document.createElement('span');
        mention.textContent = info.documentName;
        mention.setAttribute('data-document-mention', 'true');
        mention.setAttribute('data-document-id', info.documentId);
        mention.setAttribute('data-document-name', info.documentName);
        mention.setAttribute('data-block-name', info.blockName);
        if (info.blockParams && typeof info.blockParams === 'object') {
          mention.setAttribute(
            'data-block-params',
            JSON.stringify(info.blockParams)
          );
        }
        container.append(mention);
        convertDocumentMentionsToLinks(container);
        return container.innerHTML;
      } catch {
        return serializedMention;
      }
    }
  );
}
