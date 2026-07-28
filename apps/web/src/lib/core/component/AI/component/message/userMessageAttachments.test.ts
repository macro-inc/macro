import type { Attachment } from '@core/component/AI/types';
import { describe, expect, it } from 'vitest';
import { getVisibleUserMessageAttachments } from './userMessageAttachments';

describe('getVisibleUserMessageAttachments', () => {
  it('hides item cards already represented by mentions', () => {
    const attachments: Attachment[] = [
      { entity_id: 'document-id', entity_type: 'document' },
      { entity_id: 'email-id', entity_type: 'email_thread' },
      { entity_id: 'legacy-id', entity_type: 'project' },
      { entity_id: 'image-id', entity_type: 'static_file' },
    ];
    const content = [
      '<m-document-mention>{"documentId":"document-id","documentName":"Plan","blockName":"md"}</m-document-mention>',
      '<m-document-mention>{"documentId":"email-id","documentName":"Resume","blockName":"email"}</m-document-mention>',
      'What are these?',
    ].join(' ');

    expect(getVisibleUserMessageAttachments(content, attachments)).toEqual({
      images: [{ entity_id: 'image-id', entity_type: 'static_file' }],
      items: [{ entity_id: 'legacy-id', entity_type: 'project' }],
    });
  });

  it('keeps the card when malformed mention markup contains its id', () => {
    const attachments: Attachment[] = [
      { entity_id: 'document-id', entity_type: 'document' },
    ];

    expect(
      getVisibleUserMessageAttachments(
        '<m-document-mention>{"documentId":"document-id"</m-document-mention>',
        attachments
      ).items
    ).toEqual(attachments);
  });
});
