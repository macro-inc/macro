export const DOCUMENT_MENTION_TAG = 'm-document-mention';
export const DOCUMENT_MENTION_OPEN = `<${DOCUMENT_MENTION_TAG}>`;
export const DOCUMENT_MENTION_CLOSE = `</${DOCUMENT_MENTION_TAG}>`;

export function jsonToXML(tag: string, data: object): string {
  return `<${tag}>${JSON.stringify(data)}</${tag}>`;
}
