import { optimisticContextOf } from '@graphql-cache/exchange/optimistic';
import { executeGraphqlSaveEmailDraft } from '@queries/email/graphql/draft';
import type { SaveEmailDraftMutation } from '@service-storage/graphql/generated/graphql';
import { createClient } from '@urql/core';
import { createSignal, Show } from 'solid-js';
import { map, pipe } from 'wonka';
import { queuedDraftSaveArgs } from '../queries/queued-draft';

/** Exercise the real input adapter and optimistic mutation without viewer data. */
export function DraftOwnerFixture() {
  const [subject, setSubject] = createSignal('');
  const [accountReady, setAccountReady] = createSignal(true);
  const [thread, setThread] =
    createSignal<SaveEmailDraftMutation['saveEmailDraft']['thread']>();
  const [error, setError] = createSignal('');
  const client = createClient({
    url: 'http://example.test/graphql',
    exchanges: [
      () => (source) =>
        pipe(
          source,
          map((operation) => {
            const response = optimisticContextOf(operation)
              ?.optimisticResponse as SaveEmailDraftMutation;
            setThread(response.saveEmailDraft.thread);
            return {
              operation,
              stale: false,
              hasNext: false,
              extensions: {
                normalizedCacheMutationDisposition: {
                  kind: 'queued',
                  transactionId: 'queued',
                },
              },
            };
          })
        ),
    ],
  });
  const save = async () => {
    setError('');
    try {
      await executeGraphqlSaveEmailDraft(
        client,
        queuedDraftSaveArgs({
          draft: { subject: subject() },
          handles: {
            draftId: '01991e2a-3111-7000-8000-000000000001',
            threadId: 'local-thread',
          },
          senderLinkId: 'inbox',
          senderEmail: 'sender@example.com',
          senderAccount: accountReady()
            ? { macro_id: 'macro|inbox-owner@example.com' }
            : undefined,
        })
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <main>
      <label>
        Subject
        <input
          value={subject()}
          onInput={(event) => setSubject(event.currentTarget.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={accountReady()}
          onChange={(event) => setAccountReady(event.currentTarget.checked)}
        />
        Inbox metadata available
      </label>
      <button onClick={() => void save()}>Save offline draft</button>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <ul aria-label="Optimistic draft threads">
        <Show when={thread()}>
          {(draftThread) => <li>{draftThread().mailDraftPreview?.subject}</li>}
        </Show>
      </ul>
    </main>
  );
}
