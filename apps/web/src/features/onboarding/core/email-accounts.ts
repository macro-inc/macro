/** A connected Google inbox as onboarding shows it. */
export type EmailAccount = {
  address: string;
  isPrimary: boolean;
  /** The Macro user who owns the link — another user's for a shared inbox. */
  ownerId: string;
};

/**
 * The viewer's own primary inbox first. No ownership filter: linking a mailbox
 * owned by another Macro user creates a SHARED link carrying the owner's id —
 * filtering would hide an inbox the user just connected.
 */
export function orderEmailAccounts(
  accounts: readonly EmailAccount[],
  viewerId: string | undefined
): EmailAccount[] {
  const ownPrimary = (account: EmailAccount) =>
    account.isPrimary && account.ownerId === viewerId;
  return [...accounts].sort(
    (a, b) => Number(ownPrimary(b)) - Number(ownPrimary(a))
  );
}
