/** Company staff sign in with this exact email domain. */
const MACRO_STAFF_DOMAIN = 'macro.com';

/** The part after `@`, lowercased — `undefined` when it isn't an address. */
function emailDomain(address: string | undefined): string | undefined {
  const at = address?.lastIndexOf('@') ?? -1;
  if (!address || at < 1 || at === address.length - 1) return undefined;
  return address.slice(at + 1).toLowerCase();
}

/** Whether the address belongs to a Macro staff account (`@macro.com`). */
export function isMacroStaffEmail(address: string | undefined): boolean {
  return emailDomain(address?.trim()) === MACRO_STAFF_DOMAIN;
}
