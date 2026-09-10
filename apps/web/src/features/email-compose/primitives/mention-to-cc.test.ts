import { describe, expect, it, vi } from 'vitest';
import { convertContactInfoToEmailRecipient } from '../core/recipient-conversion';
import { addUserMentionToCc } from './mention-to-cc';

describe('mention recipients', () => {
  it('adds a known contact once and leaves recipients in To or Bcc untouched', () => {
    const contact = convertContactInfoToEmailRecipient({
      email: 'person@example.com',
      name: 'Person',
    });
    const setCc = vi.fn();
    const onRecipientAdded = vi.fn();
    const params = {
      mention: { email: contact.data.email },
      recipientOptions: [contact],
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: [],
      setCc,
      onRecipientAdded,
    };
    addUserMentionToCc(params);
    expect(setCc).toHaveBeenCalledWith([contact]);
    expect(onRecipientAdded).toHaveBeenCalledWith(contact.data.email);
    setCc.mockClear();
    onRecipientAdded.mockClear();
    for (const field of ['toRecipients', 'ccRecipients', 'bccRecipients'])
      addUserMentionToCc({ ...params, [field]: [contact] });
    expect(setCc).not.toHaveBeenCalled();
    expect(onRecipientAdded).not.toHaveBeenCalled();
  });
});
