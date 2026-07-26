import { INSERT_DOCUMENT_MENTION_COMMAND } from '@core/component/LexicalMarkdown/plugins/mentions';
import type { DocumentMentionInfo } from '@macro-inc/lexical-core';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core/utils/mentions';
import type { LexicalEditor } from 'lexical';

export type ChatAttachmentMention = Pick<
  DocumentMentionInfo,
  'documentId' | 'documentName' | 'blockName' | 'channelType'
>;

export function chatAttachmentMentionToMarkdown(
  mention: ChatAttachmentMention
): string {
  return buildMentionMarkdownString({
    type: 'document',
    ...mention,
    blockParams: {},
  });
}

export function insertChatAttachmentMention(
  editor: LexicalEditor,
  mention: ChatAttachmentMention
): boolean {
  return editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, mention);
}
