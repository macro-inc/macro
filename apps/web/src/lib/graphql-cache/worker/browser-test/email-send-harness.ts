import { createClient } from '@urql/core';
import { filter, map, pipe } from 'wonka';
import {
  CancelEmailSendDocument,
  type EmailThreadMessageFieldsFragment,
  SendEmailMessageDocument,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import { normalizedCacheExchange } from '../../exchange/normalized-cache-exchange';
import { executeOptimisticMutation } from '../../exchange/optimistic';
import { createWorkerCacheHost } from '../../host/worker-host';

const scope = new URLSearchParams(location.search).get('scope')!;
const host = createWorkerCacheHost({ scope });
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const requests = document.querySelector<HTMLPreElement>('#requests')!;
const editor = document.querySelector<HTMLTextAreaElement>('#body')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const draft = {
  draftId: id(2),
  threadDbId: id(3),
  senderLinkId: id(4),
  senderEmail: 'sender@example.com',
  subject: 'Offline send',
  optimisticBodyHtml: null,
  bodyText: 'Approved offline body',
};
const message: EmailThreadMessageFieldsFragment = {
  __typename: 'GraphqlSoupEmailMessage',
  id: id(2),
  threadId: id(3),
  linkId: id(4),
  providerId: null,
  replyingToId: null,
  subject: draft.subject,
  snippet: draft.bodyText,
  internalDateTs: null,
  sentAt: null,
  isRead: true,
  isStarred: false,
  isSent: false,
  isDraft: true,
  hasAttachments: false,
  scheduledSendTime: null,
  scheduledSendStatus: null,
  bodyText: draft.bodyText,
  bodyHtmlSanitized: null,
  bodyMacro: null,
  bodyReplyless: null,
  calendarInvitations: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  from: { email: draft.senderEmail, name: null, photoUrl: null },
  to: [],
  cc: [],
  bcc: [],
  labels: [],
  attachments: [],
  attachmentsDraft: [],
  attachmentsForwarded: [],
};
const attempt = {
  attemptId: new URLSearchParams(location.search).get('attempt') ?? id(1),
  linkId: id(4),
};
const exclusive = {
  entityKey: `GraphqlSoupEmailMessage:${draft.draftId}`,
  releaseOn: {
    responsePath: ['cancelEmailSend', 'attempt', 'status'],
    value: 'CANCELLED',
  },
};
const input = {
  attempt,
  message: {
    draftId: id(2),
    threadDbId: id(3),
    subject: draft.subject,
    to: [{ email: 'recipient@example.com' }],
    bodyText: draft.bodyText,
  },
  attachmentIds: [],
  forwardedAttachmentIds: [],
};
const networkCalls: string[] = [];
const client = createClient({
  url: 'http://email-send.test/graphql',
  exchanges: [
    normalizedCacheExchange(host),
    () => (source) =>
      pipe(
        source,
        filter((op) => op.kind === 'mutation'),
        map((operation) => {
          const cancel = 'attemptId' in (operation.variables?.input ?? {});
          networkCalls.push(cancel ? 'cancel' : 'send');
          requests.textContent = JSON.stringify(networkCalls);
          return {
            operation,
            stale: false,
            hasNext: false,
            data: {
              [cancel ? 'cancelEmailSend' : 'sendEmailMessage']: {
                attempt: {
                  attemptId: attempt.attemptId,
                  status: cancel ? 'CANCELLED' : 'ACCEPTED',
                  sendTime: new Date().toISOString(),
                  threadId: id(3),
                  message: { ...message, isDraft: cancel },
                },
                thread: null,
              },
            },
          };
        })
      ),
  ],
});
async function refresh() {
  const rows = await host.durableMutationIntents();
  document.documentElement.dataset.intentCount = String(rows.length);
  const row = rows[0] as
    | {
        phase: string;
        locallyCancelled: boolean;
        metadata: { replace?: boolean };
        response?: {
          sendEmailMessage?: { attempt: { status: string } };
          cancelEmailSend?: { attempt: { status: string } };
        };
      }
    | undefined;
  status.textContent = !row
    ? 'Ready'
    : row.locallyCancelled ||
        row.response?.cancelEmailSend?.attempt.status === 'CANCELLED'
      ? 'Cancelled'
      : row.phase === 'committed'
        ? 'Accepted'
        : row.metadata.replace
          ? 'Cancellation pending'
          : 'Queued';
  editor.disabled =
    !!row &&
    !row.locallyCancelled &&
    row.response?.cancelEmailSend?.attempt.status !== 'CANCELLED';
}
host.onCacheChanged(() => void refresh());
document.querySelector('#send')!.addEventListener('click', async () => {
  const result = await executeOptimisticMutation(
    client,
    SendEmailMessageDocument,
    { input },
    {
      sendEmailMessage: {
        attempt: {
          attemptId: attempt.attemptId,
          status: 'ACCEPTED',
          sendTime: null,
          threadId: id(3),
          message,
        },
        thread: null,
      },
    },
    {
      uuid: attempt.attemptId,
      durableIntent: {
        kind: 'email-send-v1',
        payload: { input, draft },
        exclusive,
      },
    }
  ).toPromise();
  error.textContent = result.error?.message ?? '';
  await refresh();
});
document.querySelector('#cancel')!.addEventListener('click', async () => {
  await executeOptimisticMutation(
    client,
    CancelEmailSendDocument,
    { input: attempt },
    {
      cancelEmailSend: {
        attempt: {
          attemptId: attempt.attemptId,
          status: 'ACCEPTED',
          sendTime: null,
          threadId: id(3),
          message,
        },
        thread: null,
      },
    },
    {
      uuid: attempt.attemptId,
      durableIntent: {
        kind: 'email-send-v1',
        replace: true,
        payload: { input, draft },
        exclusive,
      },
    }
  ).toPromise();
  await refresh();
});
document.querySelector('#close')!.addEventListener('click', () => {
  host.dispose();
  status.textContent = 'Closed';
});
await refresh();
document.documentElement.dataset.ready = 'true';
