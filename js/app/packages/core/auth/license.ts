import { useLicenseStatus } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { createMemo } from 'solid-js';

export function useHasPaidAccess() {
  const licenseStatus = useLicenseStatus();
  return createMemo((): boolean => {
    if (isNativeMobilePlatform()) return true;

    const status = licenseStatus();
    return status === 'trialing' || status === 'active';
  });
}
