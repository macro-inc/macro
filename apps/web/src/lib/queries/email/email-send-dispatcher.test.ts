import 'fake-indexeddb/auto';
import type { EmailSendAttemptFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailSendDispatcher } from './email-send-dispatcher';
import { createLocalDraftStore } from './local-draft-store';
import type { EmailSendIntent } from './send-intent';

const stores: ReturnType<typeof createLocalDraftStore>[] = [];
const runners: ReturnType<typeof createEmailSendDispatcher>[] = [];
const accepted: EmailSendAttemptFieldsFragment = {
  attemptId: 'attempt',
  status: 'ACCEPTED',
  message: null,
  threadId: 'thread',
  sendTime: '2026-10-20T20:00:00Z',
};
const intent = (id = 'attempt'): EmailSendIntent => ({
  uuid: id,
  dispatchVersion: 2,
  phase: 'pending',
  locallyCancelled: false,
  metadata: {
    kind: 'email-send-v1',
    payload: {
      input: {
        attempt: { attemptId: id, linkId: 'inbox' },
        message: {
          draftId: `draft-${id}`,
          subject: 'Approved',
          bodyText: 'Exact content',
        },
        attachmentIds: [],
        forwardedAttachmentIds: [],
      },
      draft: {
        draftId: `draft-${id}`,
        threadDbId: 'thread',
        subject: 'Approved',
        senderEmail: 'owner@example.invalid',
        senderLinkId: 'inbox',
        optimisticBodyHtml: null,
      },
    },
  },
});
async function setup() {
  const journal = createLocalDraftStore(crypto.randomUUID());
  stores.push(journal);
  const session = await journal.activate('owner');
  return { journal, session };
}
function run(options: Parameters<typeof createEmailSendDispatcher>[0]) {
  const runner = createEmailSendDispatcher(options);
  runners.push(runner);
  return runner;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-20T19:00:00Z'));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(async () => {
  for (const runner of runners.splice(0)) runner.dispose();
  for (const store of stores.splice(0)) await store.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('independent email dispatch', () => {
  it.each(['INBOX_NOT_FOUND', 'FORBIDDEN'])(
    'restores a first submission rejected with %s without inaccessible server cancellation',
    async (code) => {
      const storage = await setup();
      const original = await storage.journal.putSend(
        storage.session,
        intent(),
        true
      );
      const cancel = vi.fn();
      const submit = vi.fn(async () => {
        throw new CombinedError({
          graphQLErrors: [
            { message: 'Inbox unavailable', extensions: { code } },
          ],
        });
      });
      const runner = run({
        ...storage,
        submit,
        cancel,
        status: vi.fn(),
        report: vi.fn(),
      });
      await runner.wake();
      // A stale composer callback cannot restore the old confirmation requirement.
      await storage.journal.putSend(storage.session, {
        ...original,
        cancellationRequested: true,
      });
      await runner.wake();
      expect((await storage.journal.sends(storage.session))[0]).toMatchObject({
        locallyCancelled: true,
        metadata: { requiresServerConfirmation: false },
      });
      const restored = await storage.journal.restoreSend(
        storage.session,
        original.uuid
      );
      expect(restored?.draft.content.subject).toBe('Approved');
      expect(await storage.journal.sends(storage.session)).toEqual([]);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(cancel).not.toHaveBeenCalled();
    }
  );

  it('keeps an inbox rejection after a lost response locked until server confirmation', async () => {
    const storage = await setup();
    await storage.journal.putSend(storage.session, intent(), true);
    const first = run({
      ...storage,
      submit: async () => {
        throw new Error('Response lost');
      },
      cancel: vi.fn(),
      status: vi.fn(),
      report: vi.fn(),
    });
    await first.wake();
    first.dispose();
    vi.setSystemTime(Date.now() + 31_000);
    const denied = async () => {
      throw new CombinedError({
        graphQLErrors: [
          {
            message: 'Inbox unavailable',
            extensions: { code: 'INBOX_NOT_FOUND' },
          },
        ],
      });
    };
    const submit = vi.fn();
    const second = run({
      ...storage,
      submit,
      status: denied,
      cancel: denied,
      report: vi.fn(),
    });
    await second.wake();
    const row = (await storage.journal.sends(storage.session))[0];
    await storage.journal.putSend(storage.session, {
      ...row,
      cancellationRequested: true,
    });
    await second.wake();
    expect(submit).not.toHaveBeenCalled();
    await expect(
      storage.journal.restoreSend(storage.session, row.uuid)
    ).rejects.toThrow('Confirm cancellation');
    expect((await storage.journal.sends(storage.session))[0]).toMatchObject({
      locallyCancelled: false,
      metadata: { requiresServerConfirmation: true },
    });
  });

  it('submits a durable intent without a cache or mounted composer', async () => {
    const storage = await setup();
    await storage.journal.putSend(storage.session, intent(), true);
    const submit = vi.fn(async (row: EmailSendIntent) => {
      expect(
        (await storage.journal.sends(storage.session))[0].submissionStarted
      ).toBe(true);
      expect(row.metadata.payload.input.message.bodyText).toBe('Exact content');
      return accepted;
    });
    const status = vi.fn(async () => null);
    const runner = run({
      ...storage,
      submit,
      status,
      cancel: vi.fn(),
      report: vi.fn(),
    });
    await runner.wake();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect((await storage.journal.sends(storage.session))[0]).toMatchObject({
      phase: 'committed',
      response: { sendEmailMessage: { attempt: accepted } },
    });
  });

  it('recovers a lost acceptance response after restart without a second submission', async () => {
    const storage = await setup();
    await storage.journal.putSend(storage.session, intent(), true);
    const submit = vi.fn(async () => {
      throw new Error('Response lost after commit');
    });
    const status = vi.fn(async () => accepted);
    const first = run({
      ...storage,
      submit,
      status,
      cancel: vi.fn(),
      report: vi.fn(),
    });
    await first.wake();
    first.dispose();
    vi.setSystemTime(Date.now() + 31_000);
    const second = run({
      ...storage,
      submit,
      status,
      cancel: vi.fn(),
      report: vi.fn(),
    });
    await second.wake();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect((await storage.journal.sends(storage.session))[0].phase).toBe(
      'committed'
    );
  });

  it('cancels before the submission claim without sending any HTTP', async () => {
    const storage = await setup();
    const row = await storage.journal.putSend(storage.session, intent(), true);
    await storage.journal.putSend(storage.session, {
      ...row,
      cancellationRequested: true,
    });
    const submit = vi.fn();
    const cancel = vi.fn();
    const runner = run({
      ...storage,
      submit,
      cancel,
      status: vi.fn(),
      report: vi.fn(),
    });
    await runner.wake();
    expect(submit).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(
      (await storage.journal.sends(storage.session))[0].locallyCancelled
    ).toBe(true);
  });

  it('preserves cancellation requested during submission and dispatches it immediately after acceptance', async () => {
    const storage = await setup();
    await storage.journal.putSend(storage.session, intent(), true);
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<EmailSendAttemptFieldsFragment>();
    const submit = vi.fn(() => {
      started.resolve();
      return response.promise;
    });
    const cancel = vi.fn(async () => ({
      ...accepted,
      status: 'CANCELLED' as const,
    }));
    const runner = run({
      ...storage,
      submit,
      cancel,
      status: vi.fn(),
      report: vi.fn(),
    });
    await started.promise;
    const row = (await storage.journal.sends(storage.session))[0];
    await storage.journal.putSend(storage.session, {
      ...row,
      cancellationRequested: true,
    });
    response.resolve(accepted);
    await runner.wake();
    await runner.wake();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect((await storage.journal.sends(storage.session))[0]).toMatchObject({
      cancellationRequested: true,
      response: { sendEmailMessage: { attempt: { status: 'CANCELLED' } } },
    });
  });

  it('does not let a stalled submission block an unrelated draft', async () => {
    const storage = await setup();
    await storage.journal.putSend(storage.session, intent('slow'), true);
    await storage.journal.putSend(storage.session, intent('fast'), true);
    const slow = Promise.withResolvers<EmailSendAttemptFieldsFragment>();
    const fast = Promise.withResolvers<void>();
    const runner = run({
      ...storage,
      submit: async (row) =>
        row.uuid === 'slow' ? slow.promise : { ...accepted, attemptId: 'fast' },
      cancel: vi.fn(),
      status: vi.fn(),
      report: (row) => {
        if (row.uuid === 'fast') fast.resolve();
      },
    });
    await fast.promise;
    expect(
      (await storage.journal.sends(storage.session)).find(
        (row) => row.uuid === 'fast'
      )?.phase
    ).toBe('committed');
    slow.resolve({ ...accepted, attemptId: 'slow' });
    await runner.wake();
  });

  it('reconciles an uncertain provider outcome without resubmitting', async () => {
    const storage = await setup();
    const row = await storage.journal.putSend(storage.session, intent(), true);
    const claim = await storage.journal.claimSend(
      storage.session,
      row.uuid,
      'old',
      Date.now()
    );
    await storage.journal.settleSend(
      storage.session,
      row.uuid,
      'old',
      claim!.dispatch!.generation,
      {
        attempt: { ...accepted, status: 'DELIVERY_UNCONFIRMED' },
        nextAttemptAt: 0,
      }
    );
    const submit = vi.fn();
    const status = vi.fn(async () => ({
      ...accepted,
      status: 'SENT' as const,
    }));
    const runner = run({
      ...storage,
      submit,
      status,
      cancel: vi.fn(),
      report: vi.fn(),
    });
    await runner.wake();
    expect(submit).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledTimes(1);
    expect(
      (await storage.journal.sends(storage.session))[0].response
        ?.sendEmailMessage?.attempt.status
    ).toBe('SENT');
  });
});

describe('email journal authority', () => {
  it('leases work to one tab and fences an expired worker after reclamation', async () => {
    const { journal, session } = await setup();
    await journal.putSend(session, intent(), true);
    const claims = await Promise.all([
      journal.claimSend(session, 'attempt', 'tab-a', Date.now()),
      journal.claimSend(session, 'attempt', 'tab-b', Date.now()),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find((claim) => claim !== undefined)!;
    const second = await journal.claimSend(
      session,
      'attempt',
      'tab-c',
      Date.now() + 60_001
    );
    expect(
      await journal.settleSend(
        session,
        'attempt',
        first.dispatch!.owner!,
        first.dispatch!.generation,
        {
          attempt: accepted,
          nextAttemptAt: 0,
        }
      )
    ).toBe(false);
    expect(
      await journal.settleSend(
        session,
        'attempt',
        'tab-c',
        second!.dispatch!.generation,
        {
          attempt: accepted,
          nextAttemptAt: 0,
        }
      )
    ).toBe(true);
  });

  it('retains sends across logout but hides them and rejects callbacks in another account', async () => {
    const { journal, session } = await setup();
    await journal.putSend(session, intent(), true);
    const claim = await journal.claimSend(
      session,
      'attempt',
      'old',
      Date.now()
    );
    await journal.clear(true, session.epoch);
    const other = await journal.activate('other');
    expect(await journal.sends(other)).toEqual([]);
    expect(
      await journal.settleSend(
        session,
        'attempt',
        'old',
        claim!.dispatch!.generation,
        {
          attempt: accepted,
          nextAttemptAt: 0,
        }
      )
    ).toBe(false);
    const returned = await journal.activate('owner', crypto.randomUUID());
    expect((await journal.sends(returned))[0].metadata.payload.input).toEqual(
      intent().metadata.payload.input
    );
  });

  it('rejects changed content under the same attempt and ignores stale observer settlements', async () => {
    const { journal, session } = await setup();
    const row = await journal.putSend(session, intent(), true);
    const changed = structuredClone(row);
    changed.metadata.payload.input.message.bodyText = 'Different content';
    await expect(journal.putSend(session, changed)).rejects.toThrow(
      'cannot be changed'
    );
    const claim = await journal.claimSend(
      session,
      row.uuid,
      'worker',
      Date.now()
    );
    await journal.settleSend(
      session,
      row.uuid,
      'worker',
      claim!.dispatch!.generation,
      {
        attempt: { ...accepted, status: 'SENT' },
        nextAttemptAt: 0,
      }
    );
    await journal.putSend(session, row);
    expect(
      (await journal.sends(session))[0].response?.sendEmailMessage?.attempt
        .status
    ).toBe('SENT');
  });
});

it('restores cancellation and retires authority atomically across tabs', async () => {
  const { journal, session } = await setup();
  const approved = intent();
  approved.metadata.payload.input.restoreBodyText = 'Editable content';
  const row = await journal.putSend(session, approved, true);
  await journal.putSend(session, { ...row, cancellationRequested: true });
  const results = await Promise.all([
    journal.restoreSend(session, row.uuid),
    journal.restoreSend(session, row.uuid),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const restored = results.find(Boolean)!.draft;
  expect(restored.content.body_text).toBe('Editable content');
  expect(await journal.sends(session)).toEqual([]);
  const edited = await journal.save(session, {
    ...restored,
    expectedRevision: restored.revision,
    content: { ...restored.content, body_text: 'Newer edit after Undo' },
  });
  expect(await journal.restoreSend(session, row.uuid)).toBeUndefined();
  expect(await journal.read(session, restored.key)).toMatchObject(edited);
  await expect(
    journal.putSend(session, { ...row, cancellationRequested: true })
  ).rejects.toThrow('already resolved');
});

it('preserves newer content while fencing its pre-cancellation save callbacks', async () => {
  const { journal, session } = await setup();
  const approved = intent();
  const key = String(approved.metadata.payload.input.message.draftId);
  const generation = await journal.generation(session, key);
  const local = await journal.save(session, {
    key,
    draftId: key,
    threadId: 'thread',
    accountId: session.accountId,
    generation,
    content: { subject: 'Newer subject', body_text: 'Keep my edits' },
    attachments: [],
    status: 'dirty',
    expectedRevision: 0,
  });
  const row = await journal.putSend(session, approved, true);
  await journal.putSend(session, { ...row, cancellationRequested: true });
  await journal.update(session, key, (copy) => ({
    ...copy,
    status: 'queued',
    latestAttemptId: 'new-save',
  }));
  const restored = (await journal.restoreSend(session, row.uuid))!.draft;
  expect(restored).toMatchObject({
    status: 'dirty',
    latestAttemptId: undefined,
    content: local.content,
  });
  expect(restored.generation).not.toBe(local.generation);
});

it('continues valid sends while preserving an unsupported journal version', async () => {
  const storage = await setup();
  const future = {
    ...intent('future'),
    dispatchVersion: 99,
  } as unknown as EmailSendIntent;
  await storage.journal.putSend(storage.session, future, true);
  await storage.journal.putSend(storage.session, intent(), true);
  const submit = vi.fn(async () => accepted);
  const runner = run({
    ...storage,
    submit,
    cancel: vi.fn(),
    status: vi.fn(),
    report: vi.fn(),
  });
  await runner.wake();
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    (await storage.journal.sends(storage.session)).find(
      (row) => row.uuid === 'future'
    )
  ).toMatchObject({ dispatchVersion: 99, submissionStarted: undefined });
});

it('reserves unsupported sends against a second approval of the same draft', async () => {
  const { journal, session } = await setup();
  const future = {
    ...intent('future'),
    dispatchVersion: 99,
  } as unknown as EmailSendIntent;
  await journal.putSend(session, future, true);
  const duplicate = intent('duplicate');
  duplicate.metadata.payload.input.message.draftId =
    future.metadata.payload.input.message.draftId;
  await expect(journal.putSend(session, duplicate, true)).rejects.toThrow(
    'already queued'
  );
});

it('quarantines a malformed response without blocking unrelated dispatch', async () => {
  const storage = await setup();
  const damaged = intent('damaged');
  damaged.response = { sendEmailMessage: {} } as EmailSendIntent['response'];
  await storage.journal.putSend(storage.session, damaged, true);
  await storage.journal.putSend(storage.session, intent(), true);
  const submit = vi.fn(async () => accepted);
  await run({
    ...storage,
    submit,
    status: vi.fn(),
    cancel: vi.fn(),
    report: vi.fn(),
  }).wake();
  expect(submit).toHaveBeenCalledTimes(1);
  expect(
    (await storage.journal.sends(storage.session)).some(
      (row) => row.uuid === 'damaged'
    )
  ).toBe(true);
});

it('uses a free network slot for a new approval while an earlier request is stalled', async () => {
  const storage = await setup();
  await storage.journal.putSend(storage.session, intent('slow'), true);
  const started = Promise.withResolvers<void>();
  const slow = Promise.withResolvers<EmailSendAttemptFieldsFragment>();
  const fast = Promise.withResolvers<void>();
  const runner = run({
    ...storage,
    status: vi.fn(),
    cancel: vi.fn(),
    submit: async (row) => {
      if (row.uuid === 'slow') {
        started.resolve();
        return slow.promise;
      }
      return { ...accepted, attemptId: row.uuid };
    },
    report: (row) => {
      if (row.uuid === 'later') fast.resolve();
    },
  });
  await started.promise;
  await storage.journal.putSend(storage.session, intent('later'), true);
  await fast.promise;
  expect(
    (await storage.journal.sends(storage.session)).find(
      (row) => row.uuid === 'later'
    )?.phase
  ).toBe('committed');
  slow.resolve({ ...accepted, attemptId: 'slow' });
  await runner.wake();
});

it.each(['network', 'nested', 'mixed'])(
  'does not treat %s errors as definitive admission rejection',
  async (kind) => {
    const storage = await setup();
    await storage.journal.putSend(storage.session, intent(), true);
    const error = new CombinedError({
      networkError:
        kind === 'network' ? new Error('Connection lost') : undefined,
      graphQLErrors: [
        {
          message: 'Denied',
          extensions: { code: 'FORBIDDEN' },
          path:
            kind === 'nested'
              ? ['sendEmailMessage', 'attempt', 'message']
              : ['sendEmailMessage'],
        },
        ...(kind === 'mixed'
          ? [{ message: 'Internal failure', extensions: { code: 'INTERNAL' } }]
          : []),
      ],
    });
    const runner = run({
      ...storage,
      submit: async () => {
        throw error;
      },
      cancel: vi.fn(),
      status: vi.fn(),
      report: vi.fn(),
    });
    await runner.wake();
    expect(
      (await storage.journal.sends(storage.session))[0].locallyCancelled
    ).toBe(false);
    await expect(
      storage.journal.restoreSend(storage.session, 'attempt')
    ).rejects.toThrow('Confirm cancellation');
  }
);

it('cannot unlock a newer submission with an expired first-claim rejection', async () => {
  const { journal, session } = await setup();
  await journal.putSend(session, intent(), true);
  await journal.claimSend(session, 'attempt', 'first', Date.now());
  const second = await journal.claimSend(
    session,
    'attempt',
    'second',
    Date.now() + 60_001
  );
  expect(
    await journal.settleSend(session, 'attempt', 'first', 1, {
      rejectedBeforeAdmission: true,
      failed: true,
      nextAttemptAt: 0,
    })
  ).toBe(false);
  expect(
    await journal.settleSend(
      session,
      'attempt',
      'second',
      second!.dispatch!.generation,
      {
        attempt: accepted,
        nextAttemptAt: 0,
      }
    )
  ).toBe(true);
  expect((await journal.sends(session))[0].locallyCancelled).toBe(false);
  await expect(journal.restoreSend(session, 'attempt')).rejects.toThrow(
    'Confirm cancellation'
  );
});
