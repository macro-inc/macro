import type { Attachment, Attachments } from '@core/component/AI/types';
import { INSERT_DOCUMENT_MENTION_COMMAND } from '@core/component/LexicalMarkdown/plugins/mentions';
import {
  DOCUMENT_MENTION_TAG,
  jsonToXML,
} from '@core/component/LexicalMarkdown/utils/macroXml';
import type { DocumentMentionInfo } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';

export type ChatAttachmentMention = Pick<
  DocumentMentionInfo,
  'documentId' | 'documentName' | 'blockName' | 'channelType'
>;

export function chatAttachmentMentionToMarkdown(
  mention: ChatAttachmentMention
): string {
  return jsonToXML(DOCUMENT_MENTION_TAG, {
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

export function chatAttachmentMentionToAttachment(
  mention: ChatAttachmentMention
): Attachment {
  if (mention.blockName === 'email') {
    return {
      entity_id: mention.documentId,
      entity_type: 'email_thread',
    };
  }
  if (mention.blockName === 'project') {
    return {
      entity_id: mention.documentId,
      entity_type: 'project',
    };
  }
  if (mention.blockName === 'channel') {
    return {
      entity_id: mention.documentId,
      entity_type: 'channel',
    };
  }
  return {
    entity_id: mention.documentId,
    entity_type: 'document',
  };
}

export function attachChatAttachmentMention(
  editor: LexicalEditor,
  attachments: Attachments,
  mention: ChatAttachmentMention
): boolean {
  attachments.addAttachment(chatAttachmentMentionToAttachment(mention));
  return insertChatAttachmentMention(editor, mention);
}
