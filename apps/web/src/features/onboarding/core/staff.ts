import { emailDomain } from './team';

const MACRO_STAFF_DOMAIN = 'macro.com';

/** Whether the address belongs to a Macro staff account (`@macro.com`). */
export function isMacroStaffEmail(address: string | undefined): boolean {
  return emailDomain(address) === MACRO_STAFF_DOMAIN;
}

/** Whether this account gets the staff Bypass button on the onboarding flow. */
export function canBypassOnboarding(address: string | undefined): boolean {
  return isMacroStaffEmail(address?.trim());
}
