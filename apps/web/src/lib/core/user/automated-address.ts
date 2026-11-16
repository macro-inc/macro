/** Suggest people, not automated mailboxes. Explicitly typed addresses stay valid. */
export function isAutomatedAddress(email: string): boolean {
  const local = email.split('@')[0];
  return (
    /^(?:notifications|mailer-daemon|postmaster|bounce)(?:[+._-]|$)/i.test(
      local
    ) || /(?:no[._-]?reply|do[._-]?not[._-]?reply)/i.test(local)
  );
}
