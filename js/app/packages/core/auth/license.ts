import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { useOrganizationId } from '@core/user';
import { useUserInfo } from '@service-gql/client';
import { createMemo } from 'solid-js';

export function useHasPaidAccess() {
  const [userInfo] = useUserInfo();
  const organizationId = useOrganizationId();
  return createMemo((): boolean => {
    if (isNativeMobilePlatform()) return true;

    const [erru, info] = userInfo();
    if (erru) return false;
    return (
      !!organizationId() ||
      info.licenseStatus === 'trialing' ||
      info.licenseStatus === 'active'
    );
  });
}
