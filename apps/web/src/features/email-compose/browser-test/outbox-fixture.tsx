import { createEmailSendDispatcher } from '@queries/email/email-send-dispatcher';
import { createLocalDraftStore } from '@queries/email/local-draft-store';
import type { EmailSendIntent } from '@queries/email/send-intent';
import type { EmailSendAttemptFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';

/** Real browser journal and dispatcher; only provider HTTP is replaced. No cache exists. */
function OutboxFixture() {
  const journal = createLocalDraftStore('email-outbox-browser');
  const [rows, setRows] = createSignal<EmailSendIntent[]>([]);
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal('');
  const [restored, setRestored] = createSignal('');
  let session: Awaited<ReturnType<typeof journal.activate>>;
  let dispatcher: ReturnType<typeof createEmailSendDispatcher> | undefined;
  const refresh = async () => {
    setRows(await journal.sends(session));
  };
  const request = async (
    operation: string,
    row: EmailSendIntent,
    signal: AbortSignal
  ) => {
    const response = await fetch(`/test-email/${operation}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row.metadata.payload.input),
    });
    if (response.status === 403)
      throw new CombinedError({
        graphQLErrors: [
          {
            message: 'Inbox unavailable',
            extensions: { code: 'INBOX_NOT_FOUND' },
            path: ['sendEmailMessage'],
          },
        ],
      });
    if (!response.ok) throw new Error('Network unavailable');
    return (await response.json()) as EmailSendAttemptFieldsFragment | null;
  };
  const start = () => {
    dispatcher = createEmailSendDispatcher({
      session,
      journal,
      submit: async (row, signal) => {
        const result = await request('submit', row, signal);
        if (!result) throw new Error('Missing acceptance');
        return result;
      },
      cancel: async (row, signal) => {
        const result = await request('cancel', row, signal);
        if (!result) throw new Error('Missing cancellation');
        return result;
      },
      status: (row, signal) => request('status', row, signal),
      report: () => {},
    });
  };
  const persist = async () => {
    try {
      const uuid = crypto.randomUUID();
      const draftId = crypto.randomUUID();
      await journal.putSend(
        session,
        {
          uuid,
          dispatchVersion: 2,
          phase: 'pending',
          locallyCancelled: false,
          metadata: {
            kind: 'email-send-v1',
            payload: {
              input: {
                attachmentIds: [],
                forwardedAttachmentIds: [],
                attempt: { attemptId: uuid, linkId: 'inbox' },
                message: {
                  draftId,
                  subject: 'Approved subject',
                  bodyText: 'Frozen message',
                },
              },
              draft: {
                draftId,
                threadDbId: 'thread',
                subject: 'Approved subject',
                senderEmail: 'owner@example.invalid',
                senderLinkId: 'inbox',
                optimisticBodyHtml: null,
                bodyText: 'Frozen message',
              },
            },
          },
        },
        true
      );
      await refresh();
    } catch (failure) {
      setError(String(failure));
    }
  };
  onMount(() => {
    (async () => {
      session = await journal.activate('owner');
      await refresh();
      start();
      setReady(true);
    })().catch((failure) => setError(String(failure)));
  });
  const unsubscribe = journal.subscribe(() => {
    if (session) refresh().catch((failure) => setError(String(failure)));
  });
  onCleanup(() => {
    dispatcher?.dispose();
    unsubscribe();
    journal.close().catch((failure) => setError(String(failure)));
  });
  return (
    <main>
      <h1>Email outbox</h1>
      <button disabled={!ready()} onClick={persist}>
        Send frozen message
      </button>
      <button
        disabled={!ready()}
        onClick={async () => {
          dispatcher?.dispose();
          await journal.clear(true, session.epoch);
          session = await journal.activate('other');
          await refresh();
          start();
        }}
      >
        Switch account
      </button>
      <button
        disabled={!ready()}
        onClick={async () => {
          dispatcher?.dispose();
          session = await journal.activate('owner', crypto.randomUUID());
          await refresh();
          start();
        }}
      >
        Return to owner
      </button>
      <output data-testid="rows">{JSON.stringify(rows())}</output>
      <button
        disabled={
          !rows().some(
            (row) =>
              row.locallyCancelled && !row.metadata.requiresServerConfirmation
          )
        }
        onClick={async () => {
          const row = rows().find((row) => row.locallyCancelled);
          if (!row) return;
          try {
            const result = await journal.restoreSend(session, row.uuid);
            setRestored(result?.draft.content.body_text ?? '');
            await refresh();
          } catch (failure) {
            setError(String(failure));
          }
        }}
      >
        Restore draft
      </button>
      <output data-testid="restored">{restored()}</output>
      <output data-testid="error">{error()}</output>
    </main>
  );
}
render(() => <OutboxFixture />, document.getElementById('root')!);
