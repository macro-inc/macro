import type { useEmailLinksQuery } from '@queries/email/link';
import { type Accessor, createMemo } from 'solid-js';
import type { EmailInbox } from '../context/compose-capabilities';

export type EmailInboxQuery = Pick<
  ReturnType<typeof useEmailLinksQuery>,
  'data' | 'isSuccess' | 'isError' | 'isPending'
>;

/** Expose available inbox metadata, including cached data after a failed refresh. */
export function createEmailInboxSource(
  owner: Accessor<string | undefined>,
  query: EmailInboxQuery,
  displayName: (email: string) => string | undefined
) {
  const snapshot = createMemo<{
    owner: string | undefined;
    inboxes: EmailInbox[];
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
      email_address: inbox.email_address,
      photo_url: inbox.photo_url,
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
