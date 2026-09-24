/** The fields needed to distinguish account identity from delegated inbox access. */
export interface OnboardingEmailLink {
  email_address: string;
  macro_id: string;
  needs_reauth?: boolean;
}

export function resolveGoogleAccounts<T extends OnboardingEmailLink>(
  links: readonly T[],
  userId: string | undefined,
  accountEmail: string | undefined
) {
  const email = accountEmail?.trim().toLowerCase();
  const owned = userId ? links.filter((link) => link.macro_id === userId) : [];
  const work = email
    ? owned.find((link) => link.email_address.toLowerCase() === email)
    : undefined;
  const personal = owned.find(
    (link) => link.email_address.toLowerCase() !== email && !link.needs_reauth
  );
  return { work, personal, workConnected: !!work && !work.needs_reauth };
}
