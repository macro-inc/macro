import type { Accessor } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from '../../email-message/tests/messages';
import {
  DraftPersistRejected,
  type DraftSaveResult,
  type EmailDraftRestoration,
  type SaveEmailDraft,
} from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import type { LocalDraft } from '../core/local-draft';
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
  it('preserves the seeded ID as a handle until a save confirms it when lookup has no record', async () => {
    const context = createComposeContext();
    context.drafts.readDraft = vi.fn(async () => undefined);
    context.drafts.watchDrafts = () => () => {};
    const state = mountReplyComposer(context, undefined, {
      draft: message('existing', { is_draft: true }),
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      await state.sendEmail();
      expect(context.drafts.readDraft).toHaveBeenCalledWith('existing', {
        attachments: false,
      });
      expect(context.drafts.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          clientHandles: expect.objectContaining({ draftId: 'existing' }),
        })
      );
    } finally {
      state.dispose();
    }
  });

  it('keeps REST lifecycle reads blocked while the seeded draft identity is unresolved', async () => {
    const context = createComposeContext();
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<NonNullable<typeof context.drafts.readDraft>>>
      >();
    context.drafts.readDraft = vi.fn(() => pending.promise);
    context.drafts.watchDrafts = () => () => {};
    const draft = message('local', { is_draft: true });
    const state = mountReplyComposer(context, undefined, { draft });
    const observed = vi.mocked(context.draftLifecycle.observe).mock.calls[0][0];
    try {
      expect(observed.draftId()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(0);
      expect(observed.draftId()).toBeUndefined();
      pending.resolve({ draft, persistence: 'queued' });
      await vi.advanceTimersByTimeAsync(0);
      expect(observed.draftId()).toBeUndefined();
      vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) =>
        queued(input)
      );
      await state.sendEmail();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      vi.mocked(context.drafts.readDraft).mockResolvedValue({
        draft: message('server-1', { is_draft: true }),
        persistence: 'committed',
      });
      vi.mocked(context.drafts.saveDraft).mockResolvedValue(committed());
      await state.sendEmail();
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
    } finally {
      state.dispose();
    }
  });

  it('still blocks send when local storage identifies the seeded draft as queued', async () => {
    const context = createComposeContext();
    const draft = message('existing', { is_draft: true });
    context.drafts.readDraft = vi.fn(async () => ({
      draft,
      persistence: 'queued' as const,
    }));
    context.drafts.watchDrafts = () => () => {};
    vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) =>
      queued(input)
    );
    const state = mountReplyComposer(context, undefined, { draft });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(context.drafts.readDraft).toHaveBeenCalledWith('existing', {
        attachments: false,
      });
      await state.sendEmail();
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();
      expect(context.notices.feedback.failure).toHaveBeenLastCalledWith(
        'Failed to send email',
        { subtext: 'Draft still syncing, try again' }
      );
    } finally {
      state.dispose();
    }
  });

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
      expect(context.notices.feedback.alert).not.toHaveBeenCalled();
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
        if (firstSave === 'autosave') {
          expect(context.notices.feedback.failure).toHaveBeenCalledWith(
            'Failed to save draft'
          );
        } else {
          expect(context.notices.feedback.failure).not.toHaveBeenCalled();
        }
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
        await root.state.context.onAddAttachments([file]);
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
          root.state.context.onAddAttachments([file]),
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
            draftGeneration: 0,
            draftId: 'scheduled-server',
            threadId: 'thread',
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

    it('reads operation status only under a server-confirmed draft ID', async () => {
      const context = createComposeContext();
      let operationId: Accessor<string | undefined> = () => undefined;
      context.operations = (messageId) => {
        operationId = messageId;
        return { operation: () => undefined, resolve: async () => {} };
      };
      vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) =>
        queued(input)
      );
      const root = mount(context);
      try {
        root.edit('Queued behind the durable queue');
        await vi.advanceTimersByTimeAsync(600);
        expect(savedInputs(context)[0].clientHandles?.draftId).toBeTruthy();
        expect(operationId()).toBeUndefined();

        vi.mocked(context.drafts.saveDraft).mockResolvedValue(
          committed('server-operation')
        );
        root.edit('Confirmed by the server');
        await vi.advanceTimersByTimeAsync(600);
        expect(operationId()).toBe('server-operation');
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

    /**
     * Saves ride the offline queue and commit later. `acknowledge` makes the
     * server accept the working copy's newest revision and tells mounted
     * composers, as a queue settlement does. `send` is another tab sending
     * the draft: it captures the newest revision and locks the copy.
     */
    function queuedWorkingCopy(
      context: ReturnType<typeof createComposeContext>
    ) {
      let local: LocalDraft | undefined;
      let sentKey: string | undefined;
      let notify!: () => void;
      vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) =>
        queued(input)
      );
      context.drafts.saveLocalDraft = vi.fn(async (input) => {
        const key = input.clientHandles?.draftId ?? input.draft.db_id!;
        // A server id addresses the copy its handle created.
        const previous =
          input.clientHandles && input.clientHandles.draftId !== local?.key
            ? undefined
            : local;
        if (previous && previous.key === sentKey)
          throw new Error('Cancel and restore the queued send before editing');
        local = {
          key: previous?.key ?? key,
          draftId: previous?.draftId ?? key,
          threadId: input.clientHandles?.threadId ?? 'thread',
          accountId: 'owner',
          generation: 'local-generation',
          revision: (previous?.revision ?? 0) + 1,
          acknowledgedRevision: previous?.acknowledgedRevision ?? 0,
          status: 'dirty',
          updatedAt: Date.now(),
          content: input.draft,
          attachments: [],
        };
        return local;
      });
      context.drafts.readDraft = vi.fn(async (draftId) =>
        local &&
        local.acknowledgedRevision > 0 &&
        [local.key, 'server-draft'].includes(draftId)
          ? {
              draft: message('server-draft', { is_draft: true }),
              persistence:
                local.acknowledgedRevision >= local.revision
                  ? ('committed' as const)
                  : ('queued' as const),
              local,
            }
          : undefined
      );
      context.drafts.watchDrafts = (changed) => {
        notify = () => changed();
        return () => {};
      };
      return {
        acknowledge() {
          if (local) local = { ...local, acknowledgedRevision: local.revision };
          notify();
        },
        send() {
          sentKey = local?.key;
          return {
            generation: 'local-generation',
            revision: local?.revision ?? 0,
          };
        },
      };
    }
    const sentElsewhere = {
      type: 'sent' as const,
      draftId: 'server-draft',
      threadId: 'thread',
      inboxId: 'inbox',
      observedAt: 0,
    };
    const newDraftSaves = (
      context: ReturnType<typeof createComposeContext>
    ) => {
      const [first, ...rest] = savedInputs(context);
      return rest.filter(
        (input) =>
          input.clientHandles &&
          input.clientHandles.draftId !== first.clientHandles?.draftId
      );
    };

    it('does not copy a draft sent elsewhere into a new draft after its queued saves commit', async () => {
      const context = createComposeContext();
      const workingCopy = queuedWorkingCopy(context);
      const root = mount(context);
      try {
        root.edit('Reply that another tab sends');
        await vi.advanceTimersByTimeAsync(600);
        workingCopy.acknowledge();
        await vi.advanceTimersByTimeAsync(0);
        const observer = vi.mocked(context.draftLifecycle.observe).mock
          .calls[0][0];
        expect(observer.draftId()).toBe('server-draft');

        context.setDraftLifecycle(sentElsewhere);
        await vi.advanceTimersByTimeAsync(1000);

        expect(newDraftSaves(context)).toEqual([]);
        expect(context.notices.feedback.alert).not.toHaveBeenCalledWith(
          'This email was already sent. Your newer text was kept as a new draft and was not sent.'
        );
      } finally {
        root.dispose();
      }
    });

    it('keeps text the server never acknowledged as a new draft when the draft is sent elsewhere', async () => {
      const context = createComposeContext();
      const workingCopy = queuedWorkingCopy(context);
      const root = mount(context);
      try {
        root.edit('Reply that another device sends');
        await vi.advanceTimersByTimeAsync(600);
        workingCopy.acknowledge();
        await vi.advanceTimersByTimeAsync(0);
        root.edit('Text typed after that save');
        await vi.advanceTimersByTimeAsync(0);

        context.setDraftLifecycle(sentElsewhere);
        await vi.advanceTimersByTimeAsync(1000);

        const [kept] = newDraftSaves(context);
        expect(decodeBase64Utf8(kept.draft.body_html ?? '')).toContain(
          'Text typed after that save'
        );
        expect(context.notices.feedback.alert).toHaveBeenCalledWith(
          'This email was already sent. Your newer text was kept as a new draft and was not sent.'
        );
      } finally {
        root.dispose();
      }
    });

    it('does not copy a draft into a new draft when another tab sent edits this tab had not saved', async () => {
      const context = createComposeContext();
      const workingCopy = queuedWorkingCopy(context);
      const root = mount(context);
      try {
        root.edit('Reply that another tab sends');
        await vi.advanceTimersByTimeAsync(600);
        workingCopy.acknowledge();
        await vi.advanceTimersByTimeAsync(0);
        root.edit('Text in the working copy the send carried');
        await vi.advanceTimersByTimeAsync(0);
        // The send lands before this tab's debounced server save.
        const sentCopy = workingCopy.send();
        await vi.advanceTimersByTimeAsync(600);

        context.setDraftLifecycle({ ...sentElsewhere, sentCopy });
        await vi.advanceTimersByTimeAsync(1000);

        expect(newDraftSaves(context)).toEqual([]);
      } finally {
        root.dispose();
      }
    });

    it('keeps text the working copy refused after another tab sent the draft as a new draft', async () => {
      const context = createComposeContext();
      const workingCopy = queuedWorkingCopy(context);
      const root = mount(context);
      try {
        root.edit('Reply that another tab sends');
        await vi.advanceTimersByTimeAsync(600);
        workingCopy.acknowledge();
        await vi.advanceTimersByTimeAsync(0);
        const sentCopy = workingCopy.send();
        root.edit('Text typed after the send');
        await vi.advanceTimersByTimeAsync(600);

        context.setDraftLifecycle({ ...sentElsewhere, sentCopy });
        await vi.advanceTimersByTimeAsync(1000);

        const [kept] = newDraftSaves(context);
        expect(decodeBase64Utf8(kept.draft.body_html ?? '')).toContain(
          'Text typed after the send'
        );
      } finally {
        root.dispose();
      }
    });

    it('counts a restored committed draft as saved when it is sent elsewhere', async () => {
      const context = createComposeContext();
      vi.mocked(context.drafts.saveDraft).mockImplementation(async () =>
        committed('server-draft')
      );
      context.drafts.readDraft = vi.fn(async () => ({
        draft: message('server-draft', { is_draft: true }),
        persistence: 'committed' as const,
      }));
      let restored!: (change: EmailDraftRestoration) => void;
      context.drafts.watchRestorations = (listener) => {
        restored = listener;
        return () => {};
      };
      const root = mount(context);
      try {
        root.edit('Reply that is saved');
        await vi.advanceTimersByTimeAsync(600);
        // Restored before its debounced save, so this edit never saves.
        root.edit('Text the restore replaces');
        await vi.advanceTimersByTimeAsync(0);
        restored({
          draftId: 'server-draft',
          originalDraftId: 'server-draft',
          threadId: 'thread',
          inboxId: 'inbox',
        });
        await vi.advanceTimersByTimeAsync(0);

        context.setDraftLifecycle(sentElsewhere);
        await vi.advanceTimersByTimeAsync(1000);

        expect(newDraftSaves(context)).toEqual([]);
      } finally {
        root.dispose();
      }
    });
  }
);
