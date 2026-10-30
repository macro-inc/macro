import 'fake-indexeddb/auto';
import { createEmailSendDispatcher } from '@queries/email/email-send-dispatcher';
import {
  emailStorageSession,
  localDraftStore,
} from '@queries/email/local-drafts';
import {
  cancelEmailSendQueued,
  type EmailSendIntent,
} from '@queries/email/send-queue';
import type { EmailSendAttemptFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmailSendProgress } from '../context/compose-capabilities';
import { watchEmailSendProgress } from './send-progress';

vi.mock('@queries/email/local-drafts', async () => {
  const { createLocalDraftStore } = await import(
    '@queries/email/local-draft-store'
  );
  const localDraftStore = createLocalDraftStore(crypto.randomUUID());
  const session = localDraftStore.activate('owner');
  return {
    localDraftStore,
    emailStorageSession: () => session,
    readLocalEmailSends: async () => localDraftStore.sends(await session),
    persistLocalEmailSend: async (intent: EmailSendIntent, reserve = false) =>
      localDraftStore.putSend(await session, intent, reserve),
    watchLocalEmailSends: (changed: () => void) =>
      localDraftStore.subscribe(changed),
  };
});

const inboxes = [
  { provider: 'Gmail', linkId: 'gmail-inbox', email: 'me@gmail.example' },
  { provider: 'Outlook', linkId: 'outlook-inbox', email: 'me@outlook.example' },
] as const;
type Inbox = (typeof inboxes)[number];

const stops: (() => void)[] = [];
const runners: ReturnType<typeof createEmailSendDispatcher>[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-20T19:00:00Z'));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const runner of runners.splice(0)) runner.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function intent(inbox: Inbox): EmailSendIntent {
  const id = crypto.randomUUID();
  return {
    uuid: id,
    dispatchVersion: 2,
    phase: 'pending',
    locallyCancelled: false,
    metadata: {
      kind: 'email-send-v1',
      payload: {
        input: {
          attempt: { attemptId: id, linkId: inbox.linkId },
          message: {
            draftId: `draft-${id}`,
            subject: 'Fwd: Quarterly numbers',
            bodyText: 'See the attached numbers',
          },
          attachmentIds: [],
          forwardedAttachmentIds: [],
        },
        draft: {
          draftId: `draft-${id}`,
          threadDbId: 'thread',
          subject: 'Fwd: Quarterly numbers',
          senderEmail: inbox.email,
          senderLinkId: inbox.linkId,
          optimisticBodyHtml: null,
        },
      },
    },
  };
}

function attempt(
  queued: EmailSendIntent,
  status: EmailSendAttemptFieldsFragment['status']
): EmailSendAttemptFieldsFragment {
  return {
    attemptId: queued.uuid,
    status,
    message: null,
    threadId: 'thread',
    sendTime: '2026-10-20T19:00:10.640Z',
  };
}

/** Records one send's progress; `reached` resolves once a state is reported. */
function follow(sendAttemptId: string) {
  const updates: EmailSendProgress[] = [];
  const waiting = new Map<EmailSendProgress['state'], () => void>();
  stops.push(
    watchEmailSendProgress(sendAttemptId, (progress) => {
      updates.push(progress);
      waiting.get(progress.state)?.();
    })
  );
  return {
    updates,
    reached: (state: EmailSendProgress['state']) =>
      new Promise<void>((resolve) => {
        if (updates.some((update) => update.state === state)) resolve();
        else waiting.set(state, resolve);
      }),
  };
}

async function queue(inbox: Inbox) {
  const session = await emailStorageSession();
  const queued = await localDraftStore.putSend(session, intent(inbox), true);
  return { session, queued, progress: follow(queued.uuid) };
}

function dispatch(
  session: Awaited<ReturnType<typeof emailStorageSession>>,
  server: Pick<
    Parameters<typeof createEmailSendDispatcher>[0],
    'submit' | 'cancel' | 'status'
  >
) {
  const runner = createEmailSendDispatcher({
    session,
    journal: localDraftStore,
    report: vi.fn(),
    ...server,
  });
  runners.push(runner);
  return runner;
}

it.each(inboxes)(
  'reports a $provider send as undoable until the server deadline, then failed',
  async (inbox) => {
    const { session, queued, progress } = await queue(inbox);
    await progress.reached('pending');
    const runner = dispatch(session, {
      submit: async () => attempt(queued, 'ACCEPTED'),
      cancel: vi.fn(),
      status: async () => attempt(queued, 'FAILED'),
    });
    await runner.wake();
    await progress.reached('accepted');
    vi.setSystemTime(Date.now() + 5_000);
    await runner.wake();
    await progress.reached('failed');

    expect(progress.updates).toEqual([
      { state: 'pending' },
      { state: 'accepted', undoUntil: '2026-10-20T19:00:10.640Z' },
      { state: 'failed' },
    ]);
  }
);

it.each(inboxes)(
  'reports a $provider send the server rejects as failed',
  async (inbox) => {
    const { session, progress } = await queue(inbox);
    await progress.reached('pending');
    const runner = dispatch(session, {
      submit: async () => {
        throw new CombinedError({
          graphQLErrors: [
            {
              message: 'Attachment unavailable',
              extensions: { code: 'INVALID' },
            },
          ],
        });
      },
      cancel: vi.fn(),
      status: vi.fn(),
    });
    await runner.wake();
    await progress.reached('failed');

    expect(progress.updates).toEqual([
      { state: 'pending' },
      { state: 'failed' },
    ]);
  }
);

it.each(inboxes)(
  'stops offering Undo for a $provider send once cancellation is requested',
  async (inbox) => {
    const { session, queued, progress } = await queue(inbox);
    await progress.reached('pending');
    const runner = dispatch(session, {
      submit: async () => attempt(queued, 'ACCEPTED'),
      cancel: async () => attempt(queued, 'CANCELLED'),
      status: async () => attempt(queued, 'ACCEPTED'),
    });
    await runner.wake();
    await progress.reached('accepted');
    const current = (await localDraftStore.sends(session)).find(
      (row) => row.uuid === queued.uuid
    );
    if (!current) throw new Error('The accepted send left the outbox');
    await cancelEmailSendQueued(current);
    await runner.wake();
    await progress.reached('cancelled');

    expect(progress.updates).toEqual([
      { state: 'pending' },
      { state: 'accepted', undoUntil: '2026-10-20T19:00:10.640Z' },
      { state: 'pending' },
      { state: 'cancelled' },
    ]);
  }
);

it.each(inboxes)(
  'reports a delivered $provider send as sent',
  async (inbox) => {
    const { session, queued, progress } = await queue(inbox);
    await progress.reached('pending');
    const runner = dispatch(session, {
      submit: async () => attempt(queued, 'ACCEPTED'),
      cancel: vi.fn(),
      status: async () => attempt(queued, 'SENT'),
    });
    await runner.wake();
    await progress.reached('accepted');
    vi.setSystemTime(Date.now() + 5_000);
    await runner.wake();
    await progress.reached('sent');

    expect(progress.updates).toEqual([
      { state: 'pending' },
      { state: 'accepted', undoUntil: '2026-10-20T19:00:10.640Z' },
      { state: 'sent' },
    ]);
  }
);
