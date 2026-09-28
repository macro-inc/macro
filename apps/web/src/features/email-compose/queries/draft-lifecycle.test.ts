import type { ApiMessage } from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { deriveEmailDraftLifecycle } from './draft-lifecycle';

function draft(overrides: Partial<ApiMessage> = {}): ApiMessage {
  return {
    ...(message('draft', {
      is_draft: true,
    }) as unknown as ApiMessage),
    is_sent: false,
    ...overrides,
  };
}

describe('deriveEmailDraftLifecycle', () => {
  it('tracks an editable draft by its exact message and inbox identity', () => {
    expect(
      deriveEmailDraftLifecycle({
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        message: draft(),
        observedAt: 1,
      })
    ).toEqual({
      type: 'editing',
      draftId: 'draft',
      threadId: 'thread',
      inboxId: 'inbox',
      observedAt: 1,
    });
  });

  it('distinguishes scheduled, sent, and missing states', () => {
    expect(
      deriveEmailDraftLifecycle({
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        message: draft({ scheduled_send_time: '2026-12-01T12:00:00Z' }),
      })
    ).toMatchObject({
      type: 'scheduled',
      sendTime: '2026-12-01T12:00:00Z',
    });
    expect(
      deriveEmailDraftLifecycle({
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
        message: draft({ is_draft: false, is_sent: true }),
      })
    ).toMatchObject({ type: 'sent', draftId: 'draft', inboxId: 'inbox' });
    expect(
      deriveEmailDraftLifecycle({
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'inbox',
      })
    ).toMatchObject({ type: 'missing', draftId: 'draft' });
  });

  it('treats the same message ID from another inbox as missing', () => {
    expect(
      deriveEmailDraftLifecycle({
        draftId: 'draft',
        threadId: 'thread',
        inboxId: 'selected-inbox',
        message: draft({ link_id: 'other-inbox' }),
      })
    ).toMatchObject({
      type: 'missing',
      draftId: 'draft',
      inboxId: 'selected-inbox',
    });
  });
});
