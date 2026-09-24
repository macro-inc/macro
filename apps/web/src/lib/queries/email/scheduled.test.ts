import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchScheduledMessages } from './scheduled';

const getScheduledMessages = vi.hoisted(() => vi.fn());
vi.mock('@service-email/client', () => ({
  emailClient: { getScheduledMessages },
}));

function message(
  id: string,
  linkId: string,
  sendTime: string | null,
  overrides: { isDraft?: boolean; isSent?: boolean } = {}
) {
  return {
    db_id: id,
    thread_db_id: `thread-${id}`,
    link_id: linkId,
    is_draft: overrides.isDraft ?? true,
    is_sent: overrides.isSent ?? false,
    scheduled_send_time: sendTime,
    attachments: [],
    attachments_draft: [],
    attachments_forwarded: [],
    bcc: [],
    cc: [],
    to: [],
    created_at: '2026-09-23T00:00:00Z',
    updated_at: '2026-09-23T00:00:00Z',
    has_attachments: false,
    is_read: true,
    is_starred: false,
    labels: [],
  };
}

describe('fetchScheduledMessages', () => {
  beforeEach(() => vi.resetAllMocks());

  it('paginates each inbox, excludes undo-window rows, and orders by send time', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      message(
        `a-${index}`,
        'a',
        `2026-12-${String((index % 28) + 1).padStart(2, '0')}T12:00:00Z`
      )
    );
    const finalA = message('a-final', 'a', '2026-10-01T12:00:00Z');
    const inboxB = message('b-only', 'b', '2026-09-30T12:00:00Z');
    const undoWindow = message('undo', 'b', '2026-09-29T12:00:00Z', {
      isDraft: false,
    });
    const noSendTime = message('unscheduled', 'b', null);
    getScheduledMessages.mockImplementation(
      ({ offset }: { offset: number }, linkId: string) => {
        if (linkId === 'a' && offset === 0)
          return Promise.resolve(ok({ messages: firstPage }));
        if (linkId === 'a') return Promise.resolve(ok({ messages: [finalA] }));
        return Promise.resolve(
          ok({ messages: [undoWindow, noSendTime, inboxB] })
        );
      }
    );

    const result = await fetchScheduledMessages(['a', 'b']);

    expect(getScheduledMessages).toHaveBeenCalledWith(
      { offset: 100, limit: 100 },
      'a'
    );
    expect(result).not.toContainEqual(
      expect.objectContaining({ db_id: 'undo' })
    );
    expect(result).not.toContainEqual(
      expect.objectContaining({ db_id: 'unscheduled' })
    );
    expect(result[0].db_id).toBe('b-only');
    expect(result[1].db_id).toBe('a-final');
  });
});
