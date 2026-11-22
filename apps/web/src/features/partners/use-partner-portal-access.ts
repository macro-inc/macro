import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enablePartnerPortal } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import { type Accessor, createMemo } from 'solid-js';
import { acceptedPartnerForEmail, isMacroStaff } from './core/portal';
import { portalData } from './primitives/store';

/** The flag is on, and the account is Macro staff or an accepted partner. */
export function usePartnerPortalAccess(): Accessor<boolean> {
  const flag = useFeatureFlag(enablePartnerPortal);
  const email = useEmail();
  return createMemo(() => {
    if (!flag().enabled) return false;
    const address = email();
    if (isMacroStaff(address)) return true;
    return acceptedPartnerForEmail(portalData(), address) !== undefined;
  });
}
