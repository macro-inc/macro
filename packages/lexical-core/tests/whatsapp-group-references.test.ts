import { describe, expect, it } from 'vitest';
import { extractChannelMentionsFromMarkdown } from '../utils/markdown-mentions';
import { messageReference } from '../utils/message-references';

describe('WhatsApp group references in channel messages', () => {
  it('keeps the WhatsApp group entity type on an authored reference', () => {
    expect(
      messageReference('whatsapp_group', '01a16445-9fdc-7bb1-80b4-8935a1243c98')
    ).toEqual({
      entityType: 'whatsapp_group',
      entityId: '01a16445-9fdc-7bb1-80b4-8935a1243c98',
    });
  });

  it('extracts a WhatsApp group mention without treating it as a document', () => {
    expect(
      extractChannelMentionsFromMarkdown(
        '<m-document-mention>{"documentId":"01a16445-9fdc-7bb1-80b4-8935a1243c98","blockName":"whatsapp_group","documentName":"Design Crit","blockParams":{}}</m-document-mention>'
      )
    ).toEqual([
      {
        entityType: 'whatsapp_group',
        entityId: '01a16445-9fdc-7bb1-80b4-8935a1243c98',
      },
    ]);
  });
});
