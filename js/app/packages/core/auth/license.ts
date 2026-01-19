import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { useOrganizationId } from '@core/user';
import { useLicenseStatus } from '@queries/auth/user-info';
import { createMemo } from 'solid-js';

export function useHasPaidAccess() {
  const licenseStatus = useLicenseStatus();
  const organizationId = useOrganizationId();
  return createMemo((): boolean => {
    if (isNativeMobilePlatform()) return true;

    const status = licenseStatus();
    return !!organizationId() || status === 'trialing' || status === 'active';
  });
}
