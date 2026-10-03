import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGmailSequenceDelivery } from './gmail-delivery';

const client = vi.hoisted(() => ({
  createDraft: vi.fn(),
  scheduleMessage: vi.fn(),
  deleteDraft: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@service-email/client', () => ({ emailClient: client }));
vi.mock('@service-email/sequence-cancellation', () => ({
  cancelSequenceDraft: client.cancel,
}));
beforeEach(() => {
  vi.clearAllMocks();
  client.createDraft.mockResolvedValue(ok({ draft: { db_id: 'draft' } }));
  client.scheduleMessage.mockResolvedValue(ok({}));
  client.deleteDraft.mockResolvedValue(ok({}));
  client.cancel.mockResolvedValue(ok({}));
});
describe('Gmail sequence delivery', () => {
  it('scopes drafts and scheduling to the selected inbox and uses the server draft handle', async () => {
    const delivery = createGmailSequenceDelivery();
    const draftId = await delivery.createDraft(
      'secondary-inbox',
      'ada@example.com',
      'Hello Ada',
      'Welcome'
    );
    await delivery.schedule('secondary-inbox', draftId, '2026-10-05T16:00:00Z');
    expect(client.createDraft).toHaveBeenCalledWith(
      {
        draft: {
          subject: 'Hello Ada',
          body_text: 'Welcome',
          to: [{ email: 'ada@example.com' }],
          include_signature: false,
        },
      },
      'secondary-inbox'
    );
    expect(client.scheduleMessage).toHaveBeenCalledWith(
      {
        draftID: 'draft',
        send_time: '2026-10-05T16:00:00Z',
        include_signature: false,
      },
      'secondary-inbox'
    );
  });
  it('never deletes a message whose delivery already started', async () => {
    client.cancel.mockResolvedValue(
      err([{ code: 'DELIVERY_STARTED', message: 'already sending' }])
    );
    expect(await createGmailSequenceDelivery().cancel('inbox', 'draft')).toBe(
      'delivery_started'
    );
    expect(client.deleteDraft).not.toHaveBeenCalled();
  });
  it('does not delete drafts when scheduler cancellation fails', async () => {
    client.cancel.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'Scheduler unavailable' }])
    );
    await expect(
      createGmailSequenceDelivery().cancel('inbox', 'draft')
    ).rejects.toThrow('Scheduler unavailable');
    expect(client.deleteDraft).not.toHaveBeenCalled();
  });
  it('treats missing queued records as safe and cleans up remaining unscheduled drafts', async () => {
    client.cancel.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Not found' }])
    );
    expect(await createGmailSequenceDelivery().cancel('inbox', 'draft')).toBe(
      'canceled'
    );
    expect(client.deleteDraft).toHaveBeenCalledWith({ id: 'draft' }, 'inbox');
  });
});
