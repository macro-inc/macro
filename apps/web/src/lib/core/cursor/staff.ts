/** Whether an email belongs to a Macro staff account. */
export function isMacroStaffEmail(email: string | undefined): boolean {
  const parts = email?.toLowerCase().split('@');
  return parts?.length === 2 && parts[1] === 'macro.com';
}
