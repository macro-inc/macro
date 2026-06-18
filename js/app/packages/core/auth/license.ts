import { useLicenseStatus } from '@core/context/user';
import { createMemo } from 'solid-js';

export function useHasPaidAccess() {
  const licenseStatus = useLicenseStatus();
  return createMemo((): boolean => {
    const status = licenseStatus();
    return status === 'trialing' || status === 'active';
  });
}
