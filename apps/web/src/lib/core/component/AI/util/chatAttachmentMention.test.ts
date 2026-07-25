import type { LexicalEditor } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import {
  chatAttachmentMentionToMarkdown,
  insertChatAttachmentMention,
} from './chatAttachmentMention';

const { insertDocumentMentionCommand } = vi.hoisted(() => ({
  insertDocumentMentionCommand: {},
}));

vi.mock('@core/component/LexicalMarkdown/plugins/mentions', () => ({
  INSERT_DOCUMENT_MENTION_COMMAND: insertDocumentMentionCommand,
}));

describe('chat attachment mentions', () => {
  it('serializes an attached entity as mention markdown', () => {
    expect(
      chatAttachmentMentionToMarkdown({
        documentId: 'document-id',
        documentName: 'Project plan',
        blockName: 'md',
      })
    ).toBe(
      '<m-document-mention>{"documentId":"document-id","documentName":"Project plan","blockName":"md","blockParams":{}}</m-document-mention>'
    );
  });

  it('inserts an attached entity into the editor as a mention', () => {
    const dispatchCommand = vi.fn(() => true);
    const editor = { dispatchCommand } as unknown as LexicalEditor;
    const mention = {
      documentId: 'document-id',
      documentName: 'Project plan',
      blockName: 'md',
    };

    expect(insertChatAttachmentMention(editor, mention)).toBe(true);
    expect(dispatchCommand).toHaveBeenCalledWith(
      insertDocumentMentionCommand,
      mention
    );
  });
});
