import type { UserIconProps } from '@core/component/UserIcon';
import { emailToMacroId } from '@core/user';

// Resolve an inbox's identity from its own address, not the link's macro_id:
// an own secondary inbox shares the parent account's macro_id, so keying on the
// address gives each inbox its own name and icon.
export function inboxIconProps(emailAddress: string): UserIconProps {
  const macroId = emailToMacroId(emailAddress);
  return macroId ? { id: macroId } : { email: emailAddress };
}
