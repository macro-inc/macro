import { describe, expect, it } from 'vitest';
import { extractChannelMentionsFromMarkdown } from '../utils/markdown-mentions';
import { messageReference } from '../utils/message-references';

describe('External chat references in channel messages', () => {
  it('keeps the external chat entity type on an authored reference', () => {
    expect(
      messageReference('external_chat', '01a16445-9fdc-7bb1-80b4-8935a1243c98')
    ).toEqual({
      entityType: 'external_chat',
      entityId: '01a16445-9fdc-7bb1-80b4-8935a1243c98',
    });
  });

  it('extracts an external chat mention without treating it as a document', () => {
    expect(
      extractChannelMentionsFromMarkdown(
        '<m-document-mention>{"documentId":"01a16445-9fdc-7bb1-80b4-8935a1243c98","blockName":"external_chat","documentName":"Design Crit","blockParams":{}}</m-document-mention>'
      )
    ).toEqual([
      {
        entityType: 'external_chat',
        entityId: '01a16445-9fdc-7bb1-80b4-8935a1243c98',
      },
    ]);
  });
});
