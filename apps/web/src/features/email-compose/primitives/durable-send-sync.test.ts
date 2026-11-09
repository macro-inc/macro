import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmailMessage } from '../../email-message/core/email-message';
import { message } from '../../email-message/tests/messages';
import type {
  DraftPersistFailureCode,
  DraftSaveResult,
  EmailComposeContext,
  SaveEmailDraft,
} from '../context/compose-capabilities';
import type { LocalDraft, LocalDraftStatus } from '../core/local-draft';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Kind = 'standalone' | 'reply';
type Settlement = {
  mutationUuid?: string;
  failed: boolean;
  code?: DraftPersistFailureCode;
};

const queued = (input: SaveEmailDraft): DraftSaveResult => ({
  draftId: input.clientHandles?.draftId ?? input.draft.db_id ?? undefined,
  threadId:
    input.clientHandles?.threadId ?? input.draft.thread_db_id ?? 'thread',
  inboxId: 'inbox',
  persistence: 'queued',
});

/**
 * Outbox delivery over a working-copy store. A sync failure stays on the
 * working copy until an explicit retry, as in the production store.
 */
function durableContext() {
  const context = createComposeContext();
  context.delivery.queueActive = () => true;
  let local: LocalDraft | undefined;
  let status: LocalDraftStatus = 'dirty';
  let notify: ((settlement?: Settlement) => void) | undefined;
  context.drafts.saveLocalDraft = vi.fn(async (input): Promise<LocalDraft> => {
    const draftId = input.clientHandles?.draftId ?? input.draft.db_id!;
    local = {
      key: draftId,
      draftId,
      threadId:
        input.clientHandles?.threadId ?? input.draft.thread_db_id ?? undefined,
      accountId: 'owner',
      generation: 'generation',
      revision: (local?.revision ?? 0) + 1,
      acknowledgedRevision: 0,
      status,
      updatedAt: Date.now(),
      content: input.draft,
      attachments: [],
    };
    return local;
  });
  context.drafts.readDraft = vi.fn(async () =>
    local ? { persistence: 'queued' as const, local } : undefined
  );
  context.drafts.watchDrafts = (changed) => {
    notify = changed;
    return () => {
      notify = undefined;
    };
  };
  context.drafts.retryDraft = vi.fn(async () => {});
  return {
    context,
    local: () => local,
    /** The queue settled this draft's write, or the store changed. */
    settle(next: LocalDraftStatus, settlement?: Settlement) {
      status = next;
      if (local) local = { ...local, status };
      notify?.(settlement);
    },
  };
}

function mount(kind: Kind, context: EmailComposeContext, draft?: EmailMessage) {
  if (kind === 'standalone') {
    const root = mountEmailComposer(context, undefined, draft ? { draft } : {});
    return {
      edit: root.edit,
      dispose: root.dispose,
      async send() {
        root.state.context.onSend();
        await vi.advanceTimersByTimeAsync(0);
      },
    };
  }
  const root = mountReplyComposer(context, undefined, draft ? { draft } : {});
  return {
    edit: root.edit,
    dispose: root.dispose,
    send: root.sendEmail,
  };
}

const sentBody = (context: EmailComposeContext) =>
  vi.mocked(context.delivery.sendMessage).mock.calls[0]?.[0].message.body_text;

const refusals = (context: EmailComposeContext) =>
  vi
    .mocked(context.notices.feedback.failure)
    .mock.calls.filter(([title]) => title === 'Failed to send email');

it.each(['standalone', 'reply'] as const)(
  'sends the latest %s text once after the server fails its draft save',
  async (kind) => {
    const { context, local, settle } = durableContext();
    vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) =>
      queued(input)
    );
    const root = mount(kind, context);
    try {
      root.edit('Quarterly numbers');
      await vi.advanceTimersByTimeAsync(600);
      const handle = vi.mocked(context.drafts.saveDraft).mock.calls[0][0]
        .clientHandles?.draftId;
      expect(handle).toBeTruthy();

      // The queued save times out on the server and is rolled back.
      settle('failed', {
        mutationUuid: handle,
        failed: true,
        code: 'INTERNAL',
      });
      await vi.advanceTimersByTimeAsync(0);
      root.edit('Quarterly numbers, final');
      await vi.advanceTimersByTimeAsync(600);
      // Autosave stays latched: the failed save is not replayed.
      expect(context.drafts.saveDraft).toHaveBeenCalledOnce();

      await root.send();
      expect(refusals(context)).toEqual([]);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(context.delivery.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          clientHandles: expect.objectContaining({ draftId: handle }),
          expectedLocalVersion: {
            generation: 'generation',
            revision: local()!.revision,
          },
        })
      );
      expect(sentBody(context)).toContain('Quarterly numbers, final');
    } finally {
      root.dispose();
    }
  }
);

it.each(['standalone', 'reply'] as const)(
  'sends the latest %s text once while a slow draft save is still on the wire',
  async (kind) => {
    const { context } = durableContext();
    const slow = Promise.withResolvers<DraftSaveResult>();
    let firstSave: SaveEmailDraft | undefined;
    vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) => {
      if (firstSave) return queued(input);
      firstSave = input;
      return await slow.promise;
    });
    const root = mount(kind, context);
    try {
      root.edit('Agenda');
      await vi.advanceTimersByTimeAsync(600);
      expect(firstSave).toBeDefined();

      root.edit('Agenda for Thursday');
      await root.send();
      expect(refusals(context)).toEqual([]);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(sentBody(context)).toContain('Agenda for Thursday');

      slow.resolve(queued(firstSave!));
      await vi.advanceTimersByTimeAsync(600);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
    } finally {
      root.dispose();
    }
  }
);

it.each(['standalone', 'reply'] as const)(
  'sends the latest %s text once after reconnecting finds an unconfirmed offline save',
  async (kind) => {
    const { context, settle } = durableContext();
    vi.mocked(context.connectivity.looksOffline).mockReturnValue(true);
    vi.mocked(context.drafts.saveDraft).mockImplementation(async (input) =>
      queued(input)
    );
    const root = mount(kind, context);
    try {
      root.edit('Written on the train');
      await vi.advanceTimersByTimeAsync(600);

      // Back online, the queue cannot confirm the write it held offline.
      vi.mocked(context.connectivity.looksOffline).mockReturnValue(false);
      settle('unconfirmed');
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      root.edit('Written on the train, sent from the office');

      await root.send();
      expect(refusals(context)).toEqual([]);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(sentBody(context)).toContain(
        'Written on the train, sent from the office'
      );
    } finally {
      root.dispose();
    }
  }
);

it.each(['standalone', 'reply'] as const)(
  'sends a reopened %s draft whose last sync failed',
  async (kind) => {
    const { context, settle } = durableContext();
    settle('failed');
    context.drafts.readDraft = vi.fn(async () => ({
      persistence: 'queued' as const,
      local: {
        key: 'draft',
        draftId: 'draft',
        threadId: 'thread',
        accountId: 'owner',
        generation: 'generation',
        revision: 4,
        acknowledgedRevision: 2,
        status: 'failed' as const,
        errorCode: 'INTERNAL',
        updatedAt: Date.now(),
        content: { subject: 'Review' },
        attachments: [],
      },
    }));
    const draft = message('draft', {
      is_draft: true,
      replying_to_id: kind === 'reply' ? 'parent' : undefined,
    });
    const root = mount(kind, context, draft);
    try {
      await vi.advanceTimersByTimeAsync(0);
      root.edit('Picking this back up');
      await vi.advanceTimersByTimeAsync(600);
      expect(context.drafts.saveDraft).not.toHaveBeenCalled();

      await root.send();
      expect(refusals(context)).toEqual([]);
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      expect(context.delivery.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          clientHandles: expect.objectContaining({ draftId: 'draft' }),
        })
      );
      expect(sentBody(context)).toContain('Picking this back up');
    } finally {
      root.dispose();
    }
  }
);
