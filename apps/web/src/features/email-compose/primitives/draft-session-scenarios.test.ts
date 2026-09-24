import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DraftPersistRejected,
  type DraftSaveResult,
  type SaveEmailDraft,
} from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

/** A save the durable queue accepted under the composer's own handles. */
const queued = (input: SaveEmailDraft): DraftSaveResult => ({
  draftId: input.clientHandles?.draftId ?? input.draft.db_id ?? undefined,
  threadId:
    input.clientHandles?.threadId ?? input.draft.thread_db_id ?? 'thread',
  inboxId: 'inbox',
  persistence: 'queued',
});
const committed = (draftId = 'server-1'): DraftSaveResult => ({
  draftId,
  threadId: 'thread',
  inboxId: 'inbox',
  persistence: 'committed',
});
const savedInputs = (context: ReturnType<typeof createComposeContext>) =>
  vi.mocked(context.drafts.saveDraft).mock.calls.map(([input]) => input);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('draft session: reply composer', () => {
  it('queues saves offline under one handle, refuses to send, then sends once a save commits', async () => {
    const context = createComposeContext();
    vi.mocked(context.connectivity.looksOffline).mockReturnValue(true);
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

      vi.mocked(context.connectivity.looksOffline).mockReturnValue(false);
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
    const first = Promise.withResolvers<DraftSaveResult>();
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
    vi.mocked(context.connectivity.looksOffline).mockReturnValue(true);
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
  it.each(['pre-send', 'autosave'])(
    'sends without a draft ID after a failed first %s save',
    async (firstSave) => {
      const context = createComposeContext();
      vi.mocked(context.drafts.saveDraft).mockRejectedValue(
        new Error('Draft save unavailable')
      );
      const root = mountEmailComposer(context);
      try {
        root.edit('Send even when draft saving fails');
        if (firstSave === 'autosave') {
          await vi.advanceTimersByTimeAsync(600);
        }
        root.state.context.onSend();
        await vi.advanceTimersByTimeAsync(0);

        expect(savedInputs(context)[0].clientHandles?.draftId).toBeTruthy();
        expect(context.delivery.sendMessage).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            message: expect.objectContaining({
              db_id: undefined,
              subject: 'Review',
              body_text: expect.stringContaining(
                'Send even when draft saving fails'
              ),
            }),
          })
        );
        expect(context.notices.feedback.failure).not.toHaveBeenCalled();
      } finally {
        root.dispose();
      }
    }
  );

  it('keeps queued drafts blocked after a later save fails until the server confirms an ID', async () => {
    const context = createComposeContext();
    vi.mocked(context.drafts.saveDraft)
      .mockImplementationOnce(async (input) => queued(input))
      .mockRejectedValueOnce(new Error('Draft save unavailable'))
      .mockImplementationOnce(async () => committed('server-compose'));
    const root = mountEmailComposer(context);
    try {
      root.edit('Wait for the queued draft');
      for (let attempt = 0; attempt < 2; attempt++) {
        root.state.context.onSend();
        await vi.advanceTimersByTimeAsync(0);
        expect(context.delivery.sendMessage).not.toHaveBeenCalled();
        expect(context.notices.feedback.failure).toHaveBeenLastCalledWith(
          'Failed to send email',
          { subtext: 'Draft still syncing, try again' }
        );
      }
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ db_id: 'server-compose' }),
        })
      );
      const [first, second, third] = savedInputs(context);
      expect(second.clientHandles).toEqual(first.clientHandles);
      expect(third.clientHandles).toEqual(first.clientHandles);
    } finally {
      root.dispose();
    }
  });

  it('reuses a confirmed draft ID when its pre-send save fails', async () => {
    const context = createComposeContext();
    vi.mocked(context.drafts.saveDraft)
      .mockResolvedValueOnce(committed('existing-draft'))
      .mockRejectedValueOnce(new Error('Draft save unavailable'));
    const root = mountEmailComposer(context);
    try {
      root.edit('Already saved');
      await vi.advanceTimersByTimeAsync(600);
      root.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);
      expect(context.delivery.sendMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.objectContaining({ db_id: 'existing-draft' }),
        })
      );
    } finally {
      root.dispose();
    }
  });

  it.each(['INVALID', 'DRAFT_ALREADY_SENT'] as const)(
    'does not send a new draft rejected with %s',
    async (code) => {
      const context = createComposeContext();
      vi.mocked(context.drafts.saveDraft).mockRejectedValue(
        new DraftPersistRejected(code)
      );
      const root = mountEmailComposer(context);
      try {
        root.edit('Rejected draft');
        root.state.context.onSend();
        await vi.advanceTimersByTimeAsync(0);
        expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      } finally {
        root.dispose();
      }
    }
  );

  it.each(['save', 'upload'])(
    'refuses to send an unuploaded attachment after a failed %s',
    async (failure) => {
      const context = createComposeContext();
      const file = new File(['bytes'], 'notes.txt');
      if (failure === 'save') {
        vi.mocked(context.drafts.saveDraft).mockRejectedValue(
          new Error('Draft save unavailable')
        );
      }
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
    }
  );
});

describe.each(['reply', 'compose'] as const)(
  'saved %s draft ordering',
  (surface) => {
    const mount = (context: ReturnType<typeof createComposeContext>) => {
      if (surface === 'reply') {
        const root = mountReplyComposer(context);
        return {
          ...root,
          send: root.sendEmail,
          schedule: root.handleSendTimeChange,
          cancelSchedule: root.cancelSchedule,
          addAttachment: (file: File) => root.handleAddAttachments([file]),
        };
      }
      const root = mountEmailComposer(context);
      return {
        ...root,
        send: async () => {
          root.state.context.onSend();
          await vi.advanceTimersByTimeAsync(0);
        },
        schedule: root.state.context.schedule.onSelect,
        cancelSchedule: root.state.context.schedule.onCancel,
        addAttachment: (file: File) =>
          root.state.context.onAddAttachments([{ type: 'local', file }]),
      };
    };

    it('commits local schedule intent only after queued handles become server-confirmed', async () => {
      const context = createComposeContext();
      vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) =>
        queued(input)
      );
      vi.mocked(context.attachmentStorage.uploadAttachments).mockImplementation(
        async ({ attachments, onAttachmentAdded }) => {
          for (const file of attachments) onAttachmentAdded?.(file, 'uploaded');
        }
      );
      const root = mount(context);
      try {
        root.edit('Schedule once synced');
        await root.addAttachment(new File(['bytes'], 'notes.txt'));
        root.schedule(new Date('2027-01-01T12:00:00Z'));
        await vi.advanceTimersByTimeAsync(600);
        await root.send();
        expect(context.delivery.schedule).not.toHaveBeenCalled();
        expect(context.delivery.sendMessage).not.toHaveBeenCalled();
        expect(context.notices.feedback.failure).toHaveBeenLastCalledWith(
          'Failed to schedule email',
          {
            subtext:
              'Draft is not ready to schedule. Resolve any save or connection errors and try again',
          }
        );
        expect(
          context.attachmentStorage.uploadAttachments
        ).not.toHaveBeenCalled();
        const observer = vi.mocked(context.draftLifecycle.observe).mock
          .calls[0][0];
        expect(observer.draftId()).toBeUndefined();
        const [first, second] = savedInputs(context);
        expect(first.clientHandles?.draftId).toBeTruthy();
        expect(second.clientHandles).toEqual(first.clientHandles);
        expect(first.draft).not.toHaveProperty('send_time');
        expect(second.draft).not.toHaveProperty('send_time');

        vi.mocked(context.drafts.saveDraft).mockResolvedValue(
          committed('scheduled-server')
        );
        await root.send();
        expect(savedInputs(context)[2].clientHandles).toEqual(
          first.clientHandles
        );
        expect(
          context.attachmentStorage.uploadAttachments
        ).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            draftId: 'scheduled-server',
            inboxId: 'inbox',
          })
        );
        expect(context.delivery.schedule).toHaveBeenCalledExactlyOnceWith(
          {
            draftId: 'scheduled-server',
            sendTime: '2027-01-01T12:00:00.000Z',
            includeSignature: undefined,
          },
          'inbox'
        );
        expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      } finally {
        root.dispose();
      }
    });

    it('does not send or schedule over a queued update to an existing server draft', async () => {
      const context = createComposeContext();
      vi.mocked(context.drafts.saveDraft)
        .mockResolvedValueOnce(committed('existing'))
        .mockImplementation(async (input) => queued(input));
      const root = mount(context);
      try {
        root.edit('Saved online');
        await vi.advanceTimersByTimeAsync(600);
        root.edit('Updated behind the queue');
        await root.send();
        expect(context.delivery.sendMessage).not.toHaveBeenCalled();
        expect(context.notices.feedback.failure).toHaveBeenLastCalledWith(
          'Failed to send email',
          { subtext: 'Draft still syncing, try again' }
        );
        await root.schedule?.(new Date('2027-01-01T12:00:00Z'));
        await root.send();
        expect(context.delivery.schedule).not.toHaveBeenCalled();
        expect(context.notices.feedback.failure).toHaveBeenLastCalledWith(
          'Failed to schedule email',
          {
            subtext:
              'Draft is not ready to schedule. Resolve any save or connection errors and try again',
          }
        );
        vi.mocked(context.drafts.saveDraft).mockResolvedValue(
          committed('existing')
        );
        await root.schedule?.(null);
        await root.send();
        expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      } finally {
        root.dispose();
      }
    });

    it('resumes saving after a schedule-locked rejection is explicitly cancelled', async () => {
      const context = createComposeContext();
      vi.mocked(context.drafts.saveDraft).mockResolvedValue(
        committed('existing')
      );
      const root = mount(context);
      try {
        root.edit('Saved content');
        await vi.advanceTimersByTimeAsync(600);
        root.schedule(new Date('2027-01-01T12:00:00Z'));
        vi.mocked(context.drafts.saveDraft).mockImplementationOnce(async () => {
          context.setDraftLifecycle({
            type: 'scheduled',
            draftId: 'existing',
            threadId: 'thread',
            inboxId: 'inbox',
            sendTime: '2027-01-01T12:00:00Z',
            observedAt: Date.now(),
          });
          throw new DraftPersistRejected('INVALID');
        });
        await root.send();
        await vi.advanceTimersByTimeAsync(0);
        expect(context.delivery.schedule).not.toHaveBeenCalled();
        expect(await root.cancelSchedule()).toBe(true);
        root.edit('Editable after cancellation');
        await vi.advanceTimersByTimeAsync(600);
        expect(context.drafts.saveDraft).toHaveBeenCalledTimes(3);
        expect(savedInputs(context)[2].draft.db_id).toBe('existing');
      } finally {
        root.dispose();
      }
    });

    it('does not send a known server draft after autosave has been rejected', async () => {
      const context = createComposeContext();
      vi.mocked(context.drafts.saveDraft)
        .mockResolvedValueOnce(committed('existing'))
        .mockRejectedValue(new DraftPersistRejected('UNAUTHORIZED'));
      const root = mount(context);
      try {
        root.edit('Saved online');
        await vi.advanceTimersByTimeAsync(600);
        root.edit('Access revoked');
        await vi.advanceTimersByTimeAsync(600);
        await root.send();
        expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      } finally {
        root.dispose();
      }
    });
  }
);
