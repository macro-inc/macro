import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGmailSequenceDelivery } from './gmail-delivery';

const client = vi.hoisted(() => ({
  createDraft: vi.fn(),
  scheduleMessage: vi.fn(),
  unscheduleMessage: vi.fn(),
  deleteDraft: vi.fn(),
  getThread: vi.fn(),
  getMessage: vi.fn(),
  getScheduledMessages: vi.fn(),
}));
vi.mock('@service-email/client', () => ({ emailClient: client }));

const conflict = err([
  { code: 'HTTP_ERROR', message: 'HTTP error! status: 400' },
]);
function thread(message: Record<string, unknown>) {
  return ok({
    thread: {
      messages: [
        {
          db_id: 'draft',
          is_sent: false,
          scheduled_send_status: null,
          draft_generation: 0,
          ...message,
        },
      ],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  client.createDraft.mockResolvedValue(
    ok({
      draft: { db_id: 'draft', draft_generation: 3, thread_db_id: 'thread' },
    })
  );
  client.scheduleMessage.mockResolvedValue(ok({}));
  client.unscheduleMessage.mockResolvedValue(ok({}));
  client.deleteDraft.mockResolvedValue(ok({}));
  client.getThread.mockResolvedValue(thread({}));
  client.getMessage.mockResolvedValue(
    ok({ db_id: 'draft', draft_generation: 0 })
  );
  client.getScheduledMessages.mockResolvedValue(ok({ messages: [] }));
});

const draft = { draftId: 'draft', generation: 0, threadId: 'thread' };

describe('Gmail sequence delivery', () => {
  it('scopes drafts and scheduling to the selected inbox, keeps the server generation, and marks the send as a sequence step', async () => {
    const delivery = createGmailSequenceDelivery();
    const handle = await delivery.createDraft('secondary-inbox', {
      email: 'ada@example.com',
      subject: 'Hello Ada',
      body: 'Welcome',
    });
    expect(handle).toEqual({ id: 'draft', generation: 3, threadId: 'thread' });
    await delivery.schedule(
      'secondary-inbox',
      { draftId: handle.id, generation: handle.generation },
      '2026-10-05T16:00:00Z'
    );
    expect(client.createDraft).toHaveBeenCalledWith(
      {
        draft: {
          subject: 'Hello Ada',
          body_text: 'Welcome',
          to: [{ email: 'ada@example.com' }],
          include_signature: false,
          replying_to_id: undefined,
          reuse_reply_draft: false,
        },
      },
      'secondary-inbox'
    );
    expect(client.scheduleMessage).toHaveBeenCalledWith(
      {
        draftID: 'draft',
        draftGeneration: 3,
        send_time: '2026-10-05T16:00:00Z',
        include_signature: false,
        source: 'sequence',
      },
      'secondary-inbox'
    );
  });
  it('creates a follow-up as a reply to the previous step', async () => {
    await createGmailSequenceDelivery().createDraft('inbox', {
      email: 'ada@example.com',
      subject: 'Re: Hello Ada',
      body: 'Following up',
      replyingToId: 'first-step',
    });
    expect(client.createDraft.mock.calls[0][0].draft).toMatchObject({
      subject: 'Re: Hello Ada',
      replying_to_id: 'first-step',
    });
  });
  it('unschedules and deletes at the stored generation', async () => {
    expect(
      await createGmailSequenceDelivery().cancel('inbox', {
        ...draft,
        generation: 2,
      })
    ).toBe('canceled');
    expect(client.unscheduleMessage).toHaveBeenCalledWith(
      { draftID: 'draft', draftGeneration: 2 },
      'inbox'
    );
    expect(client.deleteDraft).toHaveBeenCalledWith(
      { id: 'draft', draftGeneration: 2 },
      'inbox'
    );
  });
  it('never deletes a message whose delivery already started', async () => {
    client.unscheduleMessage.mockResolvedValue(conflict);
    client.getThread.mockResolvedValue(
      thread({ scheduled_send_status: 'sending' })
    );
    expect(await createGmailSequenceDelivery().cancel('inbox', draft)).toBe(
      'delivery_started'
    );
    expect(client.deleteDraft).not.toHaveBeenCalled();
  });
  it('retries at the new generation when the draft was edited in the composer', async () => {
    client.unscheduleMessage
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(ok({}));
    client.getThread.mockResolvedValue(thread({ draft_generation: 4 }));
    expect(await createGmailSequenceDelivery().cancel('inbox', draft)).toBe(
      'canceled'
    );
    expect(client.unscheduleMessage).toHaveBeenLastCalledWith(
      { draftID: 'draft', draftGeneration: 4 },
      'inbox'
    );
    expect(client.deleteDraft).toHaveBeenCalledWith(
      { id: 'draft', draftGeneration: 4 },
      'inbox'
    );
  });
  it('fails loudly instead of claiming delivery when a conflict is unexplained', async () => {
    client.unscheduleMessage.mockResolvedValue(conflict);
    await expect(
      createGmailSequenceDelivery().cancel('inbox', draft)
    ).rejects.toThrow(expect.objectContaining({ code: 'cancelFailed' }));
    expect(client.deleteDraft).not.toHaveBeenCalled();
  });
  it('finds a sent step that inbox sync moved to another thread, instead of calling it canceled', async () => {
    client.unscheduleMessage.mockResolvedValue(conflict);
    client.getThread.mockImplementation(async ({ thread_id }) =>
      thread_id === 'thread'
        ? ok({ thread: { messages: [] } })
        : thread({ is_sent: true })
    );
    client.getMessage.mockResolvedValue(
      ok({ db_id: 'draft', draft_generation: 1, thread_db_id: 'synced' })
    );
    expect(await createGmailSequenceDelivery().cancel('inbox', draft)).toBe(
      'delivery_started'
    );
    expect(client.getThread).toHaveBeenLastCalledWith({
      thread_id: 'synced',
      limit: 50,
    });
    expect(client.deleteDraft).not.toHaveBeenCalled();
  });
  it('treats a deleted draft as canceled', async () => {
    client.unscheduleMessage.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Not found' }])
    );
    client.deleteDraft.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Not found' }])
    );
    expect(await createGmailSequenceDelivery().cancel('inbox', draft)).toBe(
      'canceled'
    );
  });
  it('reads a delete conflict from the draft state, using the message when no thread is stored', async () => {
    client.deleteDraft.mockResolvedValueOnce(
      err([{ code: 'CONFLICT', message: 'Resource conflict' }])
    );
    client.getMessage.mockResolvedValue(
      ok({ db_id: 'draft', draft_generation: 1 })
    );
    expect(
      await createGmailSequenceDelivery().cancel('inbox', {
        draftId: 'draft',
      })
    ).toBe('canceled');
    expect(client.getThread).not.toHaveBeenCalled();
    expect(client.deleteDraft).toHaveBeenLastCalledWith(
      { id: 'draft', draftGeneration: 1 },
      'inbox'
    );
  });
  it("lists an inbox's unsent sequence drafts only when the whole list fits", async () => {
    const page = (count: number, from = 0) =>
      ok({
        messages: Array.from({ length: count }, (_, index) => ({
          db_id: `draft-${from + index}`,
        })),
      });
    client.getScheduledMessages.mockResolvedValueOnce(page(2));
    expect(await createGmailSequenceDelivery().scheduled('inbox')).toEqual(
      new Set(['draft-0', 'draft-1'])
    );
    // Five full pages: a sixth may hold more, so the list is not whole.
    client.getScheduledMessages.mockReset();
    for (let index = 0; index < 5; index++)
      client.getScheduledMessages.mockResolvedValueOnce(
        page(1000, index * 1000)
      );
    expect(
      await createGmailSequenceDelivery().scheduled('inbox')
    ).toBeUndefined();
  });

  it('reports stalled, failed, removed, and sent steps from one scheduled list per inbox', async () => {
    const now = Date.now();
    client.getScheduledMessages.mockResolvedValue(
      ok({
        messages: [{ db_id: 'late' }, { db_id: 'failed' }, { db_id: 'orphan' }],
      })
    );
    client.getThread.mockImplementation(async ({ thread_id }) =>
      ok({
        thread: {
          messages: [
            {
              db_id: thread_id,
              is_sent: false,
              draft_generation: 0,
              scheduled_send_status:
                thread_id === 'failed' ? 'failed' : 'pending',
            },
          ],
        },
      })
    );
    const past = new Date(now - 60 * 60_000).toISOString();
    const future = new Date(now + 60 * 60_000).toISOString();
    const { issues, untracked, sent } =
      await createGmailSequenceDelivery().inspect('inbox', [
        { draftId: 'late', threadId: 'late', sendAt: past, queued: true },
        { draftId: 'failed', threadId: 'failed', sendAt: past, queued: true },
        { draftId: 'removed', sendAt: future, queued: true },
        { draftId: 'sent', sendAt: past, queued: true },
        // Drafted but not yet scheduled: not listed yet, and not missing.
        { draftId: 'drafting', sendAt: future, queued: false },
      ]);
    expect(issues).toEqual({
      late: 'stalled',
      failed: 'failed',
      removed: 'missing',
    });
    expect(sent).toEqual(['sent']);
    // Scheduled, but no step accounts for it: its record is gone.
    expect(untracked).toEqual(['orphan']);
    expect(client.getScheduledMessages).toHaveBeenCalledTimes(1);
    // Sequence sends are left out of the default list, so ask for them.
    expect(client.getScheduledMessages.mock.calls[0][0]).toMatchObject({
      source: 'sequence',
    });
  });
});
