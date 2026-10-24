import { useEmail } from '@core/context/user';
import { useMailAccountsQuery } from '@queries/email/mail-accounts';
import type { Accessor } from 'solid-js';

/** The address "Me" means in a thread: its mailbox, which may not be the Macro login. */
export function useThreadMailboxEmail(
  linkId: Accessor<string | undefined>
): Accessor<string | undefined> {
  const macroEmail = useEmail();
  const accounts = useMailAccountsQuery();
  return () =>
    accounts.data?.links.find((link) => link.id === linkId())?.email_address ??
    macroEmail();
}
