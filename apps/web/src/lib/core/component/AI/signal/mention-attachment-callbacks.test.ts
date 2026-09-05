import type { Attachment } from '@core/component/AI/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins/mentions';
import { describe, expect, it, vi } from 'vitest';
import { createMentionAttachmentCallbacks } from './mention-attachment-callbacks';

const mention: ItemMention = {
  itemId: 'doc-1',
  itemType: 'document',
  fileType: '',
};

const attachment: Attachment = {
  entity_id: 'doc-1',
  entity_type: 'document',
};

describe('mention attachment callbacks', () => {
  it('does not attach an asynchronously resolved mention removed in flight', async () => {
    let resolve!: (value: Attachment | undefined) => void;
    const resolver = vi.fn(
      () =>
        new Promise<Attachment | undefined>((done) => {
          resolve = done;
        })
    );
    const attachments = {
      addAttachment: vi.fn(),
      removeAttachment: vi.fn(),
    };
    const callbacks = createMentionAttachmentCallbacks(attachments, resolver);

    const pending = callbacks.onCreate(mention);
    callbacks.onRemove(mention);
    resolve(attachment);
    await pending;

    expect(attachments.addAttachment).not.toHaveBeenCalled();
    expect(attachments.removeAttachment).toHaveBeenCalledWith('doc-1');
  });

  it('does not let a stale create consume a re-added mention', async () => {
    const resolves: Array<(value: Attachment | undefined) => void> = [];
    const resolver = vi.fn(
      () =>
        new Promise<Attachment | undefined>((resolve) => {
          resolves.push(resolve);
        })
    );
    const attachments = {
      addAttachment: vi.fn(),
      removeAttachment: vi.fn(),
    };
    const callbacks = createMentionAttachmentCallbacks(attachments, resolver);

    const firstCreate = callbacks.onCreate(mention);
    callbacks.onRemove(mention);
    const secondCreate = callbacks.onCreate(mention);

    resolves[0]?.(attachment);
    await firstCreate;
    expect(attachments.addAttachment).not.toHaveBeenCalled();

    resolves[1]?.(attachment);
    await secondCreate;
    expect(attachments.addAttachment).toHaveBeenCalledOnce();
    expect(attachments.addAttachment).toHaveBeenCalledWith(attachment);
  });

  it('attaches a mention that is still present after resolution', async () => {
    const attachments = {
      addAttachment: vi.fn(),
      removeAttachment: vi.fn(),
    };
    const callbacks = createMentionAttachmentCallbacks(
      attachments,
      async () => attachment
    );

    await callbacks.onCreate(mention);

    expect(attachments.addAttachment).toHaveBeenCalledWith(attachment);
  });
});
