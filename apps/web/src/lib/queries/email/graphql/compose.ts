import type {
  DraftClientHandles,
  PersistedEmailIdentity,
  SaveEmailDraft,
  SendEmailDraft,
} from '@app/features/email-compose/context/compose-capabilities';
import { DraftPersistRejected } from '@app/features/email-compose/context/compose-capabilities';
import type { EmailDraft } from '@app/features/email-compose/core/email-draft';
import {
  SaveEmailDraftDocument,
  type SaveEmailDraftInput,
  SendEmailMessageDocument,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { draftContactInput, draftFailureCode } from './draft';

export function composeDraftInput(
  draft: EmailDraft,
  inboxId?: string,
  handles?: DraftClientHandles
): SaveEmailDraftInput {
  const draftId = draft.db_id ?? handles?.draftId;
  if (!draftId) throw new Error('Save the draft before sending');
  return {
    draftId,
    linkId: inboxId,
    senderEmail: draft.sender_email,
    threadDbId: draft.thread_db_id ?? handles?.threadId,
    providerId: draft.provider_id,
    providerThreadId: draft.provider_thread_id,
    replyingToId: draft.replying_to_id,
    subject: draft.subject,
    to: draft.to?.map(draftContactInput),
    cc: draft.cc?.map(draftContactInput),
    bcc: draft.bcc?.map(draftContactInput),
    bodyHtml: draft.body_html,
    bodyText: draft.body_text,
    bodyMacro: draft.body_macro,
  };
}

/** Foreground save for composers not using the durable queue. Same GraphQL
 * contract as queued saves, so alias persistence never falls back to REST. */
export async function saveEmailComposeDraft(
  input: SaveEmailDraft
): Promise<PersistedEmailIdentity> {
  const result = await getGraphqlSoupClient()
    .mutation(SaveEmailDraftDocument, {
      input: composeDraftInput(input.draft, input.inboxId, input.clientHandles),
    })
    .toPromise();
  if (result.error) {
    if (result.error.networkError) throw result.error;
    throw new DraftPersistRejected(
      draftFailureCode(result.error.graphQLErrors[0]?.extensions?.code)
    );
  }
  const saved = result.data?.saveEmailDraft;
  if (!saved) throw new Error('Draft save returned no identity');
  return {
    draftId: saved.draftId,
    threadId: saved.draft.threadId,
    inboxId: saved.draft.linkId,
  };
}

/** Delivery is online-only: no optimistic resolver/durable queue and no retry
 * that could hide an ambiguous send. The same draft handle identifies retries. */
export async function sendEmailComposeMessage(
  input: SendEmailDraft
): Promise<PersistedEmailIdentity> {
  const result = await getGraphqlSoupClient()
    .mutation(SendEmailMessageDocument, {
      input: {
        draft: composeDraftInput(
          input.message,
          input.inboxId,
          input.clientHandles
        ),
        includeSignature: input.message.include_signature,
      },
    })
    .toPromise();
  if (result.error) throw result.error;
  const sent = result.data?.sendEmailMessage;
  if (!sent) throw new Error('Send returned no delivery identity');
  return {
    draftId: sent.messageId,
    threadId: sent.threadId,
    inboxId: sent.linkId,
  };
}
