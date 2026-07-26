import type { Attachment, Attachments } from '@core/component/AI/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import { describe, expect, it, vi } from 'vitest';
import { getDirectMentionAttachment } from './directMentionAttachment';
import { createMentionAttachmentLifecycle } from './mentionAttachmentLifecycle';

const mention: ItemMention = {
  itemType: 'document',
  itemId: 'document-id',
  fileType: 'md',
};
const attachment: Attachment = {
  entity_id: 'document-id',
  entity_type: 'document',
};

function setup() {
  const addAttachment = vi.fn();
  const removeAttachment = vi.fn();
  const attachments = {
    addAttachment,
    removeAttachment,
  } as unknown as Attachments;
  const lifecycle = createMentionAttachmentLifecycle({
    attachments,
    getAttachment: () => attachment,
  });

  return { addAttachment, lifecycle, removeAttachment };
}

describe('createMentionAttachmentLifecycle', () => {
  it('removes an attachment when its mention is removed', () => {
    const { addAttachment, lifecycle, removeAttachment } = setup();

    lifecycle.onCreate(mention);
    lifecycle.onRemove(mention);

    expect(addAttachment).toHaveBeenCalledWith(attachment);
    expect(removeAttachment).toHaveBeenCalledWith('document-id');
  });

  it('keeps the attachment until the last duplicate mention is removed', () => {
    const { lifecycle, removeAttachment } = setup();

    lifecycle.onCreate(mention);
    lifecycle.onCreate(mention);
    lifecycle.onRemove(mention);
    expect(removeAttachment).not.toHaveBeenCalled();

    lifecycle.onRemove(mention);
    expect(removeAttachment).toHaveBeenCalledWith('document-id');
  });

  it('cleans up restored attachments even without a tracked create event', () => {
    const { lifecycle, removeAttachment } = setup();

    lifecycle.onRemove(mention);

    expect(removeAttachment).toHaveBeenCalledWith('document-id');
  });

  it('restores a call attachment when its deleted mention is undone', () => {
    const callMention: ItemMention = {
      itemType: 'call',
      itemId: 'call-id',
    };
    const callAttachment: Attachment = {
      entity_id: 'call-id',
      entity_type: 'document',
    };
    const addAttachment = vi.fn();
    const removeAttachment = vi.fn();
    const lifecycle = createMentionAttachmentLifecycle({
      attachments: {
        addAttachment,
        removeAttachment,
      } as unknown as Attachments,
      getAttachment: getDirectMentionAttachment,
    });

    lifecycle.onCreate(callMention);
    lifecycle.onRemove(callMention);
    lifecycle.onCreate(callMention);

    expect(addAttachment).toHaveBeenCalledTimes(2);
    expect(addAttachment).toHaveBeenNthCalledWith(1, callAttachment);
    expect(addAttachment).toHaveBeenNthCalledWith(2, callAttachment);
    expect(removeAttachment).toHaveBeenCalledWith('call-id');
  });
});
