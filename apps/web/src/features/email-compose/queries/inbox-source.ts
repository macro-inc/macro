import type { useMailAccountsQuery } from '@queries/email/mail-accounts';
import { type Accessor, createMemo } from 'solid-js';
import type { EmailInbox } from '../context/compose-capabilities';

export type EmailInboxQuery = Pick<
  ReturnType<typeof useMailAccountsQuery>,
  'data' | 'isSuccess' | 'isError' | 'isPending'
>;

type SendingInbox = EmailInbox &
  Pick<
    NonNullable<EmailInboxQuery['data']>['links'][number],
    'macro_id' | 'draft_is_signal' | 'is_primary'
  >;

/** Expose available inbox metadata, including cached data after a failed refresh. */
export function createEmailInboxSource(
  owner: Accessor<string | undefined>,
  query: EmailInboxQuery,
  displayName: (email: string) => string | undefined
) {
  const snapshot = createMemo<{
    owner: string | undefined;
    inboxes: SendingInbox[];
  }>((previous) => {
    const id = owner();
    // A newly mounted source can use cached data after a failed refresh.
    // Once mounted, failed reads may only retain the same owner's snapshot.
    if (!query.isSuccess && (!query.isError || previous))
      return {
        owner: id,
        inboxes: previous && previous.owner === id ? previous.inboxes : [],
      };
    const inboxes = (query.data?.links ?? []).map((inbox) => ({
      id: inbox.id,
      macro_id: inbox.macro_id,
      draft_is_signal: inbox.draft_is_signal,
      is_primary: inbox.is_primary,
      provider: inbox.provider,
      email_address: inbox.email_address,
      photo_url: inbox.photo_url,
      sendAs: inbox.sendAs,
      displayName: displayName(inbox.email_address),
      settings: {
        signature: inbox.settings.signature,
        signature_on_replies_forwards:
          inbox.settings.signature_on_replies_forwards,
      },
    }));
    return { owner: id, inboxes };
  });
  return {
    inboxes: () => snapshot().inboxes,
    loading: () => query.isPending,
    failed: () => query.isError,
  };
}
