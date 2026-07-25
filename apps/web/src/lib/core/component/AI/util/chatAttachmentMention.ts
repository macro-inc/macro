import { INSERT_DOCUMENT_MENTION_COMMAND } from '@core/component/LexicalMarkdown/plugins/mentions';
import type { DocumentMentionInfo } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';

export type ChatAttachmentMention = Pick<
  DocumentMentionInfo,
  'documentId' | 'documentName' | 'blockName' | 'channelType'
>;

export function chatAttachmentMentionToMarkdown(
  mention: ChatAttachmentMention
): string {
  const data = JSON.stringify({
    ...mention,
    blockParams: {},
  });
  return `<m-document-mention>${data}</m-document-mention>`;
}

export function insertChatAttachmentMention(
  editor: LexicalEditor,
  mention: ChatAttachmentMention
): boolean {
  return editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, mention);
}
