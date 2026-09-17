import { deviceLooksOffline } from '@core/util/connectivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DraftPersistRejected,
  type PersistedEmailIdentity,
  type SaveEmailDraft,
} from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

vi.mock('@core/util/connectivity', () => ({
  deviceLooksOffline: vi.fn(() => false),
}));

/** A save the durable queue accepted under the composer's own handles. */
const queued = (input: SaveEmailDraft): PersistedEmailIdentity => ({
  draftId: input.clientHandles?.draftId ?? input.draft.db_id ?? undefined,
  threadId:
    input.clientHandles?.threadId ?? input.draft.thread_db_id ?? 'thread',
  inboxId: 'inbox',
  persistence: 'queued',
});
const committed = (draftId = 'server-1'): PersistedEmailIdentity => ({
  draftId,
  threadId: 'thread',
  inboxId: 'inbox',
  persistence: 'committed',
});
const savedInputs = (context: ReturnType<typeof createComposeContext>) =>
  vi.mocked(context.drafts.saveDraft).mock.calls.map(([input]) => input);

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(deviceLooksOffline).mockReturnValue(false);
});
afterEach(() => vi.useRealTimers());

describe('draft session: reply composer', () => {
  it('queues saves offline under one handle, refuses to send, then sends once a save commits', async () => {
    const context = createComposeContext();
    vi.mocked(deviceLooksOffline).mockReturnValue(true);
    vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) =>
      queued(input)
    );
    const state = mountReplyComposer(context);
    try {
      state.edit('Typed offline');
      await vi.advanceTimersByTimeAsync(600);
      state.edit('Typed offline, again');
      await vi.advanceTimersByTimeAsync(600);
      const [first, second] = savedInputs(context);
      // Minted handles travel apart from server ids, and every save of the
      // draft reuses them so replays converge on one server row.
      expect(first.draft.db_id).toBeUndefined();
      expect(first.clientHandles?.draftId).toBeTruthy();
      expect(second.clientHandles).toEqual(first.clientHandles);

      await state.sendEmail();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.notices.feedback.failure).toHaveBeenLastCalledWith(
        'Failed to send email',
        { subtext: "You're offline" }
      );

      vi.mocked(deviceLooksOffline).mockReturnValue(false);
      vi.mocked(context.drafts.saveDraft).mockImplementation(async () =>
        committed('server-1')
      );
      await state.sendEmail();
      expect(context.delivery.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ db_id: 'server-1' }),
        })
      );
    } finally {
      state.dispose();
    }
  });

  it('asks for a retry when the pre-send save only queued, and sends once it commits', async () => {
    const context = createComposeContext();
    vi.mocked(context.drafts.saveDraft)
      .mockImplementationOnce(async (input) => queued(input))
      .mockImplementationOnce(async () => committed('server-2'));
    const state = mountReplyComposer(context);
    try {
      await state.sendEmail();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.notices.feedback.failure).toHaveBeenLastCalledWith(
        'Failed to send email',
        { subtext: 'Draft still syncing, try again' }
      );
      await state.sendEmail();
      // The retry reused the same handle; the confirmed server id went out.
      const [first, second] = savedInputs(context);
      expect(second.clientHandles).toEqual(first.clientHandles);
      expect(context.delivery.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ db_id: 'server-2' }),
        })
      );
    } finally {
      state.dispose();
    }
  });

  it('waits for an in-flight first save and sends with the id it confirmed', async () => {
    const context = createComposeContext();
    const first = Promise.withResolvers<PersistedEmailIdentity>();
    vi.mocked(context.drafts.saveDraft)
      .mockReturnValueOnce(first.promise)
      .mockImplementationOnce(async () => committed('server-3'));
    const state = mountReplyComposer(context);
    try {
      state.edit('Quick reply');
      await vi.advanceTimersByTimeAsync(600);
      const send = state.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.drafts.saveDraft).toHaveBeenCalledOnce();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      first.resolve(committed('server-3'));
      await send;
      expect(context.drafts.saveDraft).toHaveBeenCalledTimes(2);
      expect(savedInputs(context)[1].draft.db_id).toBe('server-3');
      expect(context.delivery.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ db_id: 'server-3' }),
        })
      );
    } finally {
      state.dispose();
    }
  });

  it('drops the draft and aborts the send when the pre-send save learns it was already sent', async () => {
    const context = createComposeContext();
    vi.mocked(context.drafts.saveDraft)
      .mockRejectedValueOnce(new DraftPersistRejected('DRAFT_ALREADY_SENT'))
      .mockImplementation(async () => committed('server-4'));
    const state = mountReplyComposer(context);
    try {
      await state.sendEmail();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.notices.feedback.alert).toHaveBeenCalledWith(
        'This reply was already sent'
      );
      expect(state.savedDraftId()).toBeUndefined();
      // A fresh draft afterwards saves under new handles, not the sent id.
      state.edit('A new reply');
      await vi.advanceTimersByTimeAsync(600);
      const inputs = savedInputs(context);
      expect(inputs).toHaveLength(2);
      expect(inputs[1].draft.db_id).toBeUndefined();
      expect(inputs[1].clientHandles?.draftId).not.toEqual(
        inputs[0].clientHandles?.draftId
      );
    } finally {
      state.dispose();
    }
  });

  it('latches autosave after a rejection until the draft is discarded', async () => {
    const context = createComposeContext();
    vi.mocked(context.drafts.saveDraft)
      .mockRejectedValueOnce(new DraftPersistRejected('INVALID'))
      .mockImplementation(async () => committed('server-5'));
    const state = mountReplyComposer(context);
    try {
      state.edit('Rejected content');
      await vi.advanceTimersByTimeAsync(600);
      expect(context.drafts.saveDraft).toHaveBeenCalledOnce();
      state.edit('Still rejected content');
      await vi.advanceTimersByTimeAsync(600);
      expect(context.drafts.saveDraft).toHaveBeenCalledOnce();
      await state.deleteDraftAndReset();
      await vi.advanceTimersByTimeAsync(0);
      state.edit('Fresh content');
      await vi.advanceTimersByTimeAsync(600);
      expect(context.drafts.saveDraft).toHaveBeenCalledTimes(2);
    } finally {
      state.dispose();
    }
  });

  it('refuses to attach while offline with a blocking notice', async () => {
    const context = createComposeContext();
    vi.mocked(deviceLooksOffline).mockReturnValue(true);
    const state = mountReplyComposer(context);
    try {
      await state.handleAddAttachments([new File(['bytes'], 'notes.txt')]);
      expect(context.notices.blockingNotice).toHaveBeenCalledOnce();
      expect(state.form.attachments.list()).toEqual([]);
    } finally {
      state.dispose();
    }
  });
});

describe('draft session: compose composer', () => {
  it('refuses to send while a local attachment has no record', async () => {
    const context = createComposeContext();
    const file = new File(['bytes'], 'notes.txt');
    vi.mocked(context.attachmentStorage.uploadAttachments).mockImplementation(
      async (input) => {
        input.onAttachmentUploadFailed?.(file);
        throw new Error('Upload failed');
      }
    );
    const root = mountEmailComposer(context);
    try {
      root.edit('With an attachment');
      await root.state.context.onAddAttachments([{ type: 'local', file }]);
      await vi.advanceTimersByTimeAsync(600);
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(10);
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.notices.feedback.failure).toHaveBeenLastCalledWith(
        'Failed to send email',
        { subtext: 'Attachment not uploaded' }
      );
    } finally {
      root.dispose();
    }
  });
});
