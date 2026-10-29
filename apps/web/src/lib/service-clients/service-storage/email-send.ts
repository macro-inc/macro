import { SERVER_HOSTS } from '@core/constant/servers';
import { createClient, fetchExchange } from '@urql/core';
import {
  CancelEmailSendDocument,
  EmailSendAttemptDocument,
  PendingEmailSendsDocument,
  type SendEmailAttemptInput,
  SendEmailMessageDocument,
} from './graphql/generated/graphql';
import { dssGraphqlFetch } from './graphql-soup';

// Delivery already has a durable email journal. Never pass these operations
// through the normalized-cache exchange or its general mutation queue.
const client = createClient({
  url: `${SERVER_HOSTS['document-storage-service']}/items/soup/graphql`,
  preferGetMethod: false,
  exchanges: [fetchExchange],
  fetch: dssGraphqlFetch,
});

export async function submitEmailSend(
  input: SendEmailAttemptInput,
  signal: AbortSignal
) {
  const result = await client
    .mutation(SendEmailMessageDocument, { input }, { fetchOptions: { signal } })
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Email acceptance was not confirmed');
  return result.data.sendEmailMessage.attempt;
}

export async function cancelEmailSend(
  input: SendEmailAttemptInput['attempt'],
  signal: AbortSignal
) {
  const result = await client
    .mutation(CancelEmailSendDocument, { input }, { fetchOptions: { signal } })
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Email cancellation was not confirmed');
  return result.data.cancelEmailSend.attempt;
}

export async function readEmailSendStatus(
  input: SendEmailAttemptInput['attempt'],
  signal: AbortSignal
) {
  const result = await client
    .query(
      EmailSendAttemptDocument,
      { input },
      {
        requestPolicy: 'network-only',
        fetchOptions: { signal },
      }
    )
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Email status was not confirmed');
  return result.data.user.emailSendAttempt;
}

export async function readPendingEmailSends(
  after: string | undefined,
  signal: AbortSignal
) {
  const result = await client
    .query(
      PendingEmailSendsDocument,
      { after },
      {
        requestPolicy: 'network-only',
        fetchOptions: { signal },
      }
    )
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Pending email sends could not be loaded');
  return result.data.user;
}
