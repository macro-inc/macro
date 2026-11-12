import { describe, expect, it } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { canReplyAll } from './recipient-conversion';

describe('canReplyAll', () => {
  it('is false when the sender is the only other participant', () => {
    const received = message('one-to-one', {
      from: { email: 'sender@example.com' },
      to: [{ email: 'Viewer@example.com' }],
      cc: [{ email: 'SENDER@example.com' }],
    });

    expect(canReplyAll(received, ['viewer@example.com'])).toBe(false);
  });

  it('is true when another recipient is on To or Cc', () => {
    const toOther = message('to-other', {
      to: [{ email: 'viewer@example.com' }, { email: 'other@example.com' }],
    });
    const ccOther = message('cc-other', {
      cc: [{ email: 'other@example.com' }],
    });

    expect(canReplyAll(toOther, ['viewer@example.com'])).toBe(true);
    expect(canReplyAll(ccOther, ['viewer@example.com'])).toBe(true);
  });

  it('treats send-as aliases as the viewer', () => {
    const toAlias = message('to-alias', {
      to: [{ email: 'viewer@example.com' }],
      cc: [{ email: 'alias@example.com' }],
    });

    expect(
      canReplyAll(toAlias, ['viewer@example.com', 'alias@example.com'])
    ).toBe(false);
  });

  it("is false on the viewer's own message, which Reply already sends to everyone", () => {
    const sent = message('sent', {
      from: { email: 'alias@example.com' },
      to: [{ email: 'one@example.com' }, { email: 'two@example.com' }],
    });

    expect(
      canReplyAll(sent, ['viewer@example.com', 'alias@example.com'])
    ).toBe(false);
  });
});
